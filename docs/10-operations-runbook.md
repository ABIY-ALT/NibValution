# Operations Runbook

For the bank's IT operations team: how to install, run, upgrade, back up and restore the NIB Property Valuation system, and what to do when something goes wrong. Measured figures come from the Phase 8 tests (`docs/09-performance-and-load.md`).

---

## 1. What runs where

| Component | What it is | Notes |
|---|---|---|
| Reverse proxy | nginx, or IIS with ARR | Terminates TLS, forwards to the app, limits upload size |
| Application | Node.js 20.11+ running the Next.js production build | Two processes recommended (§5) |
| Database | PostgreSQL 16+ | Holds everything except document files |
| Document store | A directory on local or network disk (`STORAGE_LOCAL_ROOT`) | Uploaded files; `documents/` and `quarantine/` |
| Malware scanner | ClamAV `clamd` (TCP 3310) | Required in production; uploads are quarantined without it |
| Mail server | SMTP | **Not connected yet** (§12) |
| Scheduler | cron, systemd timers or Windows Task Scheduler | Calls two HTTPS endpoints (§6) |

Recommended sizing: application server 4 vCPU / 8 GB; database 4 vCPU / 8 GB, SSD.

---

## 2. Configuration

All configuration is environment variables, validated at start-up. In production the application **refuses to start** if a required value is missing or unsafe, and the log names the variable.

| Variable | Production value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Set automatically by `next start` |
| `APP_ENV` | `production` | Turns on the strict checks below. Use `staging` for UAT |
| `APP_URL` | `https://valuation.<bank domain>` | Must be HTTPS; session cookies are `Secure` because of it |
| `TRUSTED_PROXY_HOPS` | `1` (one reverse proxy) | How many proxies append to `X-Forwarded-For`. Wrong values mean wrong addresses in the audit log |
| `DATABASE_URL` | `postgresql://app_user:…@db-host:5432/nib_valuation?schema=public` | Application login; not a superuser |
| `DATABASE_POOL_MAX` | `10` | Connections **per process** |
| `SESSION_SECRET` | 32+ random characters | Validated but not currently used; sessions are random tokens stored hashed. Set it anyway |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` | `30` / `8` | Sign-out after inactivity / after a working day |
| `STORAGE_DRIVER` | `local` | `s3` is not implemented; the application refuses to start with it |
| `STORAGE_LOCAL_ROOT` | e.g. `/srv/nib-valuation/storage` | Must be backed up with the database (§8) |
| `SCANNER_DRIVER` | `clamav` | `none` is refused in production |
| `CLAMAV_HOST` / `CLAMAV_PORT` | scanner host / `3310` | |
| `MAIL_DRIVER` | `smtp` | `log` is refused in production. See §12: SMTP is not connected yet |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | from the bank | |
| `SMS_DRIVER`, `SMS_API_URL`, `SMS_API_KEY` | `log` until a gateway is named | |
| `SIGNATURE_PROVIDER` | `local` (or `external` once the bank's PKI is connected) | |
| `SIGNATURE_LOCAL_PRIVATE_KEY` | PEM of an EC P-256 key, from the secret store | Signs valuation reports. Keep a copy of its **public** key: it is what old reports verify against after a rotation (§10) |
| `SIGNATURE_RETIRED_PUBLIC_KEYS` | the public keys of earlier signing keys, one PEM after another | Verification only: reports signed before a rotation keep showing "signature valid" |
| `CRON_SECRET` | 24+ random characters | Protects the scheduled jobs. Unset = the jobs do not exist |
| `DEPLOYMENT_VERSION` | the release number, e.g. `2026.10.1` | Needed when two or more processes serve (§5) |
| `LOG_LEVEL` | `info` | `debug` only while investigating |
| `MFA_REQUIRED` | leave unset | Multi-factor sign-in is not implemented |

Generate random values with `openssl rand -base64 32`. Keep secrets in the bank's secret store, never in the repository; `.env.example` lists every variable with comments.

Settings the department changes itself (upload limits, password rules, sign-in limits, SLA calendar, approval thresholds) live in the database and are edited in the Administration screens, not here.

---

## 3. First installation

```bash
# On the application server, as the service account
git clone <repository> /srv/nib-valuation/app && cd /srv/nib-valuation/app
npm ci
# Provide the environment (§2), e.g. /etc/nib-valuation/env, then:
npx prisma migrate deploy        # creates the schema, triggers and indexes
npx tsx prisma/seed/index.ts     # reference data and the initial administrator
npm run build                    # prisma generate + next build
```

The seed prints the accounts it created. Every seeded account must change its password at first sign-in. **In production, delete or deactivate the sample branch and staff accounts** once real users exist; they are for UAT.

Database account: the application user needs `SELECT, INSERT, UPDATE, DELETE` on the schema. Migrations need a user that can create tables, triggers and indexes; run them with a separate migration account if the bank's policy requires it.

---

## 4. Reverse proxy

nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name valuation.bank.example;

    ssl_certificate     /etc/ssl/certs/valuation.pem;
    ssl_certificate_key /etc/ssl/private/valuation.key;

    # Uploads are limited to 25 MB each by the application; allow the form overhead.
    client_max_body_size 30m;
    proxy_read_timeout   120s;

    location / {
        proxy_pass http://nib_valuation;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Appends the client's address; TRUSTED_PROXY_HOPS=1 reads exactly this entry.
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}

upstream nib_valuation {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}
```

The application sets its own security headers (CSP with a per-request nonce, HSTS, `X-Frame-Options: DENY`), so the proxy should not add or override them.

With IIS + ARR, enable "Preserve client IP" (`X-Forwarded-For` append) and set `maxAllowedContentLength` to 31457280.

---

## 5. Running the application

Two processes on ports 3000 and 3001, from **the same build directory**. Next.js embeds the server-action encryption key in the build, so processes from different builds cannot understand each other's forms ("Failed to find Server Action").

systemd (`/etc/systemd/system/nib-valuation@.service`):

```ini
[Unit]
Description=NIB Property Valuation (port %i)
After=network.target

[Service]
User=nibval
WorkingDirectory=/srv/nib-valuation/app
EnvironmentFile=/etc/nib-valuation/env
ExecStart=/usr/bin/npx next start -p %i
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now nib-valuation@3000 nib-valuation@3001
```

On Windows Server, register each process as a service with NSSM (`nssm install NIBValuation3000 "C:\Program Files\nodejs\npx.cmd" "next start -p 3000"`, working directory the app folder, environment from the secret store).

**Windows application control (WDAC, AppLocker, Smart App Control).** The password-hashing library ships a native module, `argon2.win32-x64-msvc.node`, which such policies may block. Sign-in keeps working: the application switches to a built-in WebAssembly implementation and logs `Native Argon2 could not be loaded; using the WebAssembly implementation`. For best performance under sign-in bursts, allow that file by path or hash in the policy.

Health check for the load balancer or monitoring: `GET /api/health` returns 200 `{"status":"ok"}`, or 503 when the database is unreachable. It needs no sign-in.

---

## 6. Scheduled jobs

| Job | Schedule | Call |
|---|---|---|
| SLA sweep: turnaround states, "approaching" and "breached" notices | every 15 minutes | `POST https://<host>/api/cron/sla` |
| Maintenance: removes sessions expired over 7 days ago | daily, 02:00 | `POST https://<host>/api/cron/maintenance` |

Both need the header `Authorization: Bearer <CRON_SECRET>`. Example crontab:

```cron
*/15 * * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://valuation.bank.example/api/cron/sla >/dev/null
0 2 * * *     curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://valuation.bank.example/api/cron/maintenance >/dev/null
```

The SLA sweep also runs on page loads, at most every 5 minutes, but a quiet night has no page loads. Overlapping sweeps are safe: each change is claimed by exactly one sweep, so nobody is notified twice.

---

## 7. Upgrading

1. Read the release notes and `prisma/migrations/` for new migrations. **Migrations are forward-only.**
2. Back up the database and the document store (§8).
3. On the server: `git pull && npm ci`.
4. `npx prisma migrate deploy`.
5. `DEPLOYMENT_VERSION=<new version> npm run build`.
6. Restart the processes one at a time: `systemctl restart nib-valuation@3000`, check `/api/health`, then `nib-valuation@3001`. With `DEPLOYMENT_VERSION` set, browsers holding the old version reload instead of failing.
7. Sign in and open a case: that is the smoke test.

**Rollback.** The build can be rolled back by checking out the previous release and rebuilding. The database cannot be rolled back by migration, because they are forward-only: restore the step 2 backup instead. A failed upgrade after users have entered data must be discussed with the department before restoring.

---

## 8. Backup and restore

What must be backed up, **together**:

1. The database, with `pg_dump`.
2. The document store directory (`STORAGE_LOCAL_ROOT`). Files are never modified once written, so copying it *after* the database dump gives a consistent pair: every file the dump refers to is present.
3. The signing key and the environment, which live in the secret store.

Nightly database backup:

```bash
pg_dump --format=custom --compress=6 --no-owner \
        --file=/backup/nib_valuation_$(date +%F).dump "$DATABASE_URL_BACKUP"
rsync -a /srv/nib-valuation/storage/ /backup/storage/
```

Keep 30 daily and 12 monthly copies, off the database server. Audit records are evidence, so the bank's record-retention policy decides how long the monthly copies are kept.

Restore:

```bash
createdb nib_valuation_restore
pg_restore --no-owner --jobs=4 --exit-on-error -d nib_valuation_restore /backup/nib_valuation_<date>.dump
# Verify: the two outputs must be identical when restoring a copy of a live system
psql -d nib_valuation         -At -f scripts/ops/verify-restore.sql > source.txt
psql -d nib_valuation_restore -At -f scripts/ops/verify-restore.sql > restored.txt
diff source.txt restored.txt
```

`verify-restore.sql` compares row counts, content fingerprints (cases, audit log, report and document hashes), the protective triggers and constraints, and the applied migrations. It also **tries to change the audit log and the timeline and requires both to refuse**, because a restore that lost a trigger would leave history silently editable.

Rehearsed on 30 September 2026:

| Database | Size | Dump | Restore | Result |
|---|---|---|---|---|
| Production-scale test data (50,000 cases, 1.5 M rows) | 109 MB dump | 9 s | 11 s | identical |
| Development data (signed report, 47 documents) | small | <1 s | <1 s | identical |

Rehearse a restore at least every quarter, and after every major upgrade.

---

## 9. Monitoring and logs

- Logs are JSON lines on standard output (pino). Collect them with the platform's log shipper. Every entry of a request carries its `correlationId`, which also appears in the audit log, so a complaint can be traced from the screen to the database.
- Alert on `/api/health` returning anything but 200, on `"level":"error"` entries, and on the SLA cron job failing.
- The **Audit Log** screen (Administration) shows every sign-in, upload, download, transition and configuration change, with before and after values. The database refuses to change or delete audit entries.

---

## 10. Routine tasks

| Task | How |
|---|---|
| Unlock a user | Administration → Users → Unlock |
| Sign a user out everywhere | Deactivate and reactivate the account, or change their password; either ends every session at the next request |
| Add a public holiday | Administration → SLA & Calendar |
| Change sign-in limits | Setting `security.login_attempts_per_ip` (per address, per 5 minutes; default 100). Accounts lock after `security.max_failed_logins` failures |
| Rotate `CRON_SECRET` | Change it in the secret store and the scheduler together, then restart |
| Rotate the signing key | `openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt` for the new key. Extract the current key's public half (`openssl pkey -pubout`) and **append it to `SIGNATURE_RETIRED_PUBLIC_KEYS`**, then deploy the new private key and restart. Open an old signed report: it must still say the signature is valid. Without the retired key it would show "unknown key" |

---

## 11. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Application exits at start with "Invalid environment" | A production check failed | The log names the variable; see §2 |
| "Too many attempts, try again in N seconds" for a whole office | Many people signing in from one address | Raise `security.login_attempts_per_ip`; check `TRUSTED_PROXY_HOPS` is right, or every user appears to come from the proxy |
| Audit log shows the proxy's address for everyone | `TRUSTED_PROXY_HOPS` too low, or the proxy does not append `X-Forwarded-For` | Fix the proxy header (§4) or the hops |
| "Failed to find Server Action" after an upgrade | Processes from different builds, or a stale browser | Restart every process from the same build; set `DEPLOYMENT_VERSION` |
| Uploads stay "quarantined" | Scanner unreachable | Check `clamd` on `CLAMAV_HOST:CLAMAV_PORT` |
| Notifications show "Failed" in email status | Mail server not connected or unreachable | See §12 |
| Warning "Native Argon2 could not be loaded" | Application-control policy | Sign-in still works (§5); allow the file for best performance |
| `/api/health` returns 503 | Database unreachable | Check PostgreSQL and `DATABASE_URL`; the log has the error |
| A page is slow with a large audit log | Index missing after a restore | Run `verify-restore.sql`; the indexes section must list the trigram indexes |

---

## 12. Go-live blockers (owned by the bank)

| Item | Status |
|---|---|
| Mail server (SMTP host, port, account, sender) | Needed. Production refuses the log driver, and email notifications will be marked failed until the SMTP adapter is connected |
| SMS gateway | Optional at go-live; stays on `log` |
| Signature infrastructure (assumption 5.2) | Local ECDSA key works; the external PKI adapter awaits the bank's choice |
| Malware scanner endpoint (assumption 5.4) | Needed: production refuses to start without one |
| Valuation parameters confirmed by PVD (Phase 3) | Needed before figures are relied on |
| Public holidays entered | Needed for correct SLA due dates |
| Final-letter wording | Neutral draft in place; PVD to supply the bank's text |
| TLS certificate and DNS name | Needed |
