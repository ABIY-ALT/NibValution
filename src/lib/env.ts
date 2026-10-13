import { z } from 'zod';

/**
 * Environment validation.
 *
 * Configuration mistakes are caught at start-up rather than at the moment a
 * user tries to sign a report. Several rules here are deliberately stricter in
 * production than in development - a placeholder session secret or a missing
 * malware scanner is tolerable on a laptop and unacceptable on a bank's server.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * The *deployment* environment, which is not the same thing as NODE_ENV.
     * `next build` always sets NODE_ENV=production, including when a developer
     * builds on a laptop, so gating the hard production rules on NODE_ENV alone
     * would make a local production build impossible.
     *
     * APP_ENV defaults to NODE_ENV, so a real deployment that never sets it
     * still gets the strict checks. Relaxing them is therefore an explicit,
     * visible opt-out rather than an accident.
     */
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
    APP_URL: z.string().url().default('http://localhost:3008'),

    /**
     * Reverse proxies in front of the application that append to
     * X-Forwarded-For. The client's address is read that many entries from the
     * right; anything further left was written by the client and is ignored.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.'),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(480).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(8),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    /**
     * Where the local driver keeps uploaded files. Must be outside the
     * application directory; unset means `../NibValutionStorage`, a sibling of
     * the project folder (see LocalStorageProvider).
     */
    STORAGE_LOCAL_ROOT: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    SCANNER_DRIVER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().optional(),

    MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('NIB Property Valuation <no-reply@nibbank.example>'),

    SMS_DRIVER: z.enum(['log', 'http']).default('log'),
    SMS_API_URL: z.string().optional(),
    SMS_API_KEY: z.string().optional(),

    /** Bearer token a scheduler presents to /api/cron/*. Unset disables the endpoints. */
    CRON_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(24, 'CRON_SECRET must be at least 24 characters.').optional(),
    ),

    SIGNATURE_PROVIDER: z.enum(['local', 'external']).default('local'),
    SIGNATURE_LOCAL_PRIVATE_KEY: z.string().optional(),
    /**
     * PEM public keys of signing keys retired by rotation, concatenated. Reports
     * signed before a rotation verify against these; nothing is signed with them.
     */
    SIGNATURE_RETIRED_PUBLIC_KEYS: z.string().optional(),
    SIGNATURE_EXTERNAL_URL: z.string().optional(),
    SIGNATURE_EXTERNAL_API_KEY: z.string().optional(),

    MFA_REQUIRED: booleanish.default(false),
    SEED_DEFAULT_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const deploymentEnv = env.APP_ENV ?? env.NODE_ENV;
    if (deploymentEnv !== 'production') return;

    if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3 storage requires S3_BUCKET and credentials.',
      });
    }

    // Fail-closed: with no scanner configured, uploads are quarantined rather
    // than released, so a production deployment without one is a misconfiguration
    // the operator should be told about at start-up (assumption 5.4).
    if (env.SCANNER_DRIVER === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['SCANNER_DRIVER'],
        message:
          'A malware scanner must be configured in production; uploads would otherwise be quarantined.',
      });
    }

    if (env.MAIL_DRIVER === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: 'MAIL_DRIVER=log discards notifications and must not be used in production.',
      });
    }

    if (env.SIGNATURE_PROVIDER === 'local' && !env.SIGNATURE_LOCAL_PRIVATE_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SIGNATURE_LOCAL_PRIVATE_KEY'],
        message: 'The local signature provider requires a signing key.',
      });
    }

    if (env.SIGNATURE_PROVIDER === 'external' && !env.SIGNATURE_EXTERNAL_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SIGNATURE_EXTERNAL_URL'],
        message: 'The external signature provider requires an endpoint URL.',
      });
    }

    if (env.APP_URL.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL must use HTTPS in production; session cookies depend on it.',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function loadServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Lazily validated environment. Accessing any property triggers validation, so
 * importing this module in a client bundle (which has no server variables)
 * cannot fail the build on its own - but reading a value there will.
 */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return loadServerEnv()[prop as keyof ServerEnv];
  },
});

/** The deployment environment: APP_ENV when set, otherwise NODE_ENV. */
export function deploymentEnv(): 'development' | 'test' | 'staging' | 'production' {
  const env = loadServerEnv();
  return env.APP_ENV ?? env.NODE_ENV;
}

export function isProduction(): boolean {
  return deploymentEnv() === 'production';
}

export function isDevelopment(): boolean {
  return deploymentEnv() === 'development';
}
