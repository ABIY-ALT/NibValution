-- Synthetic production-scale volume for query tuning, load tests and the
-- backup/restore rehearsal (roadmap Phase 8).
--
-- ONLY for a disposable database (e.g. nib_valuation_perf) that has been
-- migrated and seeded. It refuses to run anywhere whose name does not end in
-- _perf, so it cannot be pointed at the real one by mistake.
--
--   psql -d nib_valuation_perf -v cases=50000 -f scripts/perf/generate-volume.sql
--
-- Five years of work at roughly the bank's rate: cases dated 2021-2025 (the
-- application numbers new cases by the current year, so none can collide),
-- ~85% finished, the rest spread over the live statuses, each with its SLA
-- record, timeline, tasks, notifications, audit rows and a property.

\set ON_ERROR_STOP on
\if :{?cases}
\else
  \set cases 50000
\endif

DO $$
BEGIN
  IF current_database() NOT LIKE '%\_perf' THEN
    RAISE EXCEPTION 'Refusing to generate volume in %: use a database whose name ends in _perf', current_database();
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE ref AS
SELECT
  (SELECT id FROM departments WHERE code = 'PVD') AS dept_id,
  (SELECT id FROM sla_policies WHERE code = 'STANDARD') AS policy_id,
  (SELECT array_agg(id ORDER BY code) FROM request_types) AS request_types,
  (SELECT array_agg(u.id ORDER BY u."employeeId") FROM users u JOIN user_roles ur ON ur."userId" = u.id
     JOIN roles r ON r.id = ur."roleId" WHERE r.code = 'MAKER') AS makers,
  (SELECT array_agg(u.id ORDER BY u."employeeId") FROM users u JOIN user_roles ur ON ur."userId" = u.id
     JOIN roles r ON r.id = ur."roleId" WHERE r.code = 'CHECKER') AS checkers,
  (SELECT id FROM users WHERE "employeeId" = 'NIB-MGR-001') AS maker_manager,
  (SELECT id FROM users WHERE "employeeId" = 'NIB-MGR-002') AS checker_manager,
  (SELECT id FROM property_categories WHERE discipline = 'CIVIL' AND "isActive" ORDER BY "sortOrder" LIMIT 1) AS civil_category;

-- Requesters with their branch, so every case belongs to its requester's unit.
CREATE TEMP TABLE requesters AS
SELECT row_number() OVER (ORDER BY u."employeeId") - 1 AS n, u.id AS user_id, u."organizationId" AS org_id
FROM users u JOIN user_roles ur ON ur."userId" = u.id JOIN roles r ON r.id = ur."roleId"
WHERE r.code = 'PROCESS_OWNER' AND u."organizationId" IS NOT NULL;

CREATE TEMP TABLE gen AS
SELECT
  g AS n,
  gen_random_uuid() AS id,
  2021 + (g % 5) AS yr,
  timestamptz '2021-01-04 08:00+03' + ((g % 5) * interval '365 days') + (random() * interval '360 days') AS created_at,
  CASE WHEN g % 5 IN (0, 1, 2) THEN 'CIVIL' ELSE 'MECHANICAL' END::"Discipline" AS discipline,
  CASE
    WHEN g % 100 < 70 THEN 'COMPLETED'
    WHEN g % 100 < 80 THEN 'ARCHIVED'
    WHEN g % 100 < 85 THEN 'CANCELLED'
    ELSE (ARRAY['REQUESTED','ASSIGNED','ON_PROGRESS','SUBMITTED_FOR_CHECKING','CHECKING','COMMENTED',
                'RETURNED_FOR_CORRECTION','CHECKED','PENDING_MANAGER_APPROVAL','PENDING_DIRECTOR_APPROVAL',
                'APPROVED','AWAITING_REQUESTER','PENDING','NOT_VISITED','SIGNED'])[1 + (g % 15)]
  END::"CaseStatus" AS status,
  (SELECT count(*) FROM requesters) AS requester_count,
  (ARRAY['Abebe','Tigist','Mulugeta','Hirut','Dawit','Selamawit','Getachew','Meseret','Yohannes','Birtukan',
         'Tesfaye','Almaz','Kebede','Aster','Girma','Rahel','Solomon','Hanna','Bekele','Saba'])[1 + (g % 20)]
    || ' ' ||
  (ARRAY['Tadesse','Haile','Mengistu','Wolde','Alemu','Girma','Bekele','Tesfaye','Assefa','Kebede',
         'Desta','Gebre','Negash','Ayele','Worku','Lemma','Abate','Tefera','Mekonnen','Yirga'])[1 + ((g / 20) % 20)]
    AS person,
  round((500000 + random() * 60000000)::numeric, 2) AS value
FROM generate_series(1, :cases) AS g;

INSERT INTO valuation_cases (
  id, "caseNumber", "requestTypeId", discipline, status, version, "requestingOrgId", "departmentId",
  "requestedById", "makerId", "checkerId", "makerManagerId", "checkerManagerId", "applicantName", "ownerName",
  "finalValue", "forcedSaleValue", currency, "requestedAt", "assignedAt", "startedAt", "submittedAt",
  "checkedAt", "approvedAt", "completedAt", "archivedAt", "cancelledAt", "cancelReason", "createdAt", "updatedAt"
)
SELECT
  g.id,
  'PV-' || g.yr || '-' || lpad((row_number() OVER (PARTITION BY g.yr ORDER BY g.created_at))::text, 6, '0'),
  ref.request_types[1 + (g.n % array_length(ref.request_types, 1))],
  g.discipline, g.status, 1 + (g.n % 9),
  req.org_id, ref.dept_id, req.user_id,
  CASE WHEN g.status IN ('REQUESTED','AWAITING_REQUESTER') THEN NULL
       ELSE ref.makers[1 + (g.n % array_length(ref.makers, 1))] END,
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED','CHECKING','COMMENTED','RETURNED_FOR_CORRECTION','CHECKED',
                         'PENDING_MANAGER_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED','SIGNED')
       THEN ref.checkers[1 + (g.n % array_length(ref.checkers, 1))] END,
  ref.maker_manager, ref.checker_manager,
  g.person, g.person,
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED','CHECKED','PENDING_MANAGER_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED','SIGNED')
       THEN g.value END,
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED','CHECKED','PENDING_MANAGER_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED','SIGNED')
       THEN round(g.value * 0.7, 2) END,
  'ETB',
  g.created_at, g.created_at + interval '4 hours', g.created_at + interval '1 day', g.created_at + interval '3 days',
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED') THEN g.created_at + interval '4 days' END,
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED') THEN g.created_at + interval '5 days' END,
  CASE WHEN g.status IN ('COMPLETED','ARCHIVED') THEN g.created_at + interval '6 days' END,
  CASE WHEN g.status = 'ARCHIVED' THEN g.created_at + interval '40 days' END,
  CASE WHEN g.status = 'CANCELLED' THEN g.created_at + interval '2 days' END,
  CASE WHEN g.status = 'CANCELLED' THEN 'Customer withdrew the facility request' END,
  g.created_at, g.created_at + interval '6 days'
FROM gen g
CROSS JOIN ref
JOIN requesters req ON req.n = g.n % g.requester_count;

INSERT INTO case_number_sequences (year, "lastValue", "updatedAt")
SELECT yr, count(*), now() FROM gen GROUP BY yr
ON CONFLICT (year) DO UPDATE SET "lastValue" = GREATEST(case_number_sequences."lastValue", EXCLUDED."lastValue");

INSERT INTO sla_records (id, "caseId", "policyId", "startedAt", "dueAt", "completedAt", "elapsedWorkingDays",
                         "netWorkingDays", "pausedSeconds", status, "breachedAt", "updatedAt")
SELECT gen_random_uuid(), c.id, ref.policy_id, c."requestedAt", c."requestedAt" + interval '7 days',
       COALESCE(c."completedAt", c."cancelledAt"),
       CASE WHEN c."completedAt" IS NOT NULL THEN 4 + (random() * 3)::int ELSE 2 END,
       CASE WHEN c."completedAt" IS NOT NULL THEN 4 + (random() * 2)::int ELSE 2 END,
       0,
       CASE WHEN c."completedAt" IS NOT NULL OR c."cancelledAt" IS NOT NULL THEN 'CLOSED'
            WHEN c.status = 'AWAITING_REQUESTER' THEN 'PAUSED'
            ELSE (ARRAY['GREEN','WARNING','BREACHED'])[1 + (abs(hashtext(c.id::text)) % 3)] END::"SlaStatus",
       CASE WHEN random() < 0.12 THEN c."requestedAt" + interval '8 days' END,
       c."updatedAt"
FROM valuation_cases c CROSS JOIN ref
WHERE c.id IN (SELECT id FROM gen);

-- The timeline: six entries a case.
INSERT INTO workflow_history (id, "caseId", "fromStatus", "toStatus", action, "actorId", "actorRole", "occurredAt")
SELECT gen_random_uuid(), c.id, s.from_status::"CaseStatus", s.to_status::"CaseStatus", s.action,
       c."requestedById", 'PROCESS_OWNER', c."createdAt" + s.step * interval '20 hours'
FROM valuation_cases c
JOIN gen g ON g.id = c.id
CROSS JOIN (VALUES
  (0, 'DRAFT', 'REQUESTED', 'SUBMIT_REQUEST'),
  (1, 'REQUESTED', 'ASSIGNED', 'ASSIGN_MAKER'),
  (2, 'ASSIGNED', 'ON_PROGRESS', 'START_VALUATION'),
  (3, 'ON_PROGRESS', 'SUBMITTED_FOR_CHECKING', 'SUBMIT_FOR_CHECKING'),
  (4, 'SUBMITTED_FOR_CHECKING', 'CHECKING', 'ASSIGN_CHECKER'),
  (5, 'CHECKING', 'CHECKED', 'COMPLETE_CHECKING')
) AS s(step, from_status, to_status, action);

-- Tasks: four completed per case, and the one open task a live case waits on.
INSERT INTO workflow_tasks (id, "caseId", "taskType", "assigneeId", "roleCode", "dueAt", "createdAt", "completedAt", "completedById")
SELECT gen_random_uuid(), c.id, t.task_type::"TaskType", COALESCE(c."makerId", c."makerManagerId"), t.role_code,
       c."createdAt" + interval '5 days', c."createdAt" + t.step * interval '1 day',
       c."createdAt" + (t.step + 1) * interval '1 day', COALESCE(c."makerId", c."makerManagerId")
FROM valuation_cases c
JOIN gen g ON g.id = c.id
CROSS JOIN (VALUES
  (0, 'ASSIGN_MAKER', 'MAKER_MANAGER'), (1, 'PERFORM_VALUATION', 'MAKER'),
  (2, 'ASSIGN_CHECKER', 'CHECKER_MANAGER'), (3, 'PERFORM_CHECKING', 'CHECKER')
) AS t(step, task_type, role_code)
WHERE c.status IN ('COMPLETED', 'ARCHIVED');

INSERT INTO workflow_tasks (id, "caseId", "taskType", "assigneeId", "roleCode", "dueAt", "createdAt")
SELECT gen_random_uuid(), c.id,
       CASE WHEN c.status IN ('REQUESTED','AWAITING_REQUESTER') THEN 'ASSIGN_MAKER'
            WHEN c.status IN ('CHECKING','COMMENTED','SUBMITTED_FOR_CHECKING') THEN 'PERFORM_CHECKING'
            WHEN c.status = 'PENDING_MANAGER_APPROVAL' THEN 'MANAGER_APPROVAL'
            WHEN c.status = 'PENDING_DIRECTOR_APPROVAL' THEN 'DIRECTOR_APPROVAL'
            ELSE 'PERFORM_VALUATION' END::"TaskType",
       CASE WHEN c.status IN ('CHECKING','COMMENTED') THEN c."checkerId"
            WHEN c.status IN ('REQUESTED','AWAITING_REQUESTER','PENDING_MANAGER_APPROVAL') THEN NULL
            ELSE c."makerId" END,
       CASE WHEN c.status IN ('REQUESTED','AWAITING_REQUESTER','PENDING_MANAGER_APPROVAL') THEN 'MAKER_MANAGER' END,
       c."createdAt" + interval '5 days', c."updatedAt"
FROM valuation_cases c
JOIN gen g ON g.id = c.id
WHERE c.status NOT IN ('COMPLETED', 'ARCHIVED', 'CANCELLED', 'APPROVED', 'SIGNED');

-- Notifications: eight a case, spread over the people who worked it, most read.
INSERT INTO notifications (id, "recipientId", "caseId", "eventType", channel, subject, body, status, "sentAt", "readAt", "createdAt")
SELECT gen_random_uuid(),
       (ARRAY[c."requestedById", COALESCE(c."makerId", c."makerManagerId"), c."makerManagerId",
              COALESCE(c."checkerId", c."checkerManagerId"), c."checkerManagerId"])[1 + (k % 5)],
       c.id,
       (ARRAY['CASE_REQUESTED','CASE_ASSIGNED','CASE_SUBMITTED_FOR_CHECKING','CHECKER_ASSIGNED',
              'CHECKING_COMPLETED','MANAGER_APPROVAL_REQUIRED','CASE_COMPLETED','FINAL_REPORT_AVAILABLE'])[1 + k],
       (ARRAY['IN_APP','EMAIL'])[1 + (k % 2)]::"NotificationChannel",
       'Case ' || c."caseNumber" || ' update', 'Case ' || c."caseNumber" || ' moved on.',
       'SENT', c."createdAt" + k * interval '15 hours',
       CASE WHEN c."createdAt" < now() - interval '30 days' OR random() < 0.5 THEN c."createdAt" + k * interval '16 hours' END,
       c."createdAt" + k * interval '15 hours'
FROM valuation_cases c
JOIN gen g ON g.id = c.id
CROSS JOIN generate_series(0, 7) AS k;

-- The audit trail: ten rows a case.
INSERT INTO audit_logs (id, "actorId", "actorRole", action, entity, "entityId", after, "ipAddress", "userAgent", "correlationId", "occurredAt")
SELECT gen_random_uuid(), c."requestedById", 'PROCESS_OWNER',
       (ARRAY['CASE_CREATED','DOCUMENT_UPLOADED','CASE_TRANSITIONED','CASE_TRANSITIONED','VALUATION_CALCULATED',
              'CASE_TRANSITIONED','DOCUMENT_DOWNLOADED','CASE_TRANSITIONED','REPORT_GENERATED','CASE_TRANSITIONED'])[1 + k],
       'ValuationCase', c.id::text, jsonb_build_object('step', k), '10.10.' || (k % 250) || '.' || (c.version * 7 % 250),
       'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', gen_random_uuid()::text, c."createdAt" + k * interval '12 hours'
FROM valuation_cases c
JOIN gen g ON g.id = c.id
CROSS JOIN generate_series(0, 9) AS k;

-- A property for every case: a plot for civil work, one or two vehicles for mechanical.
INSERT INTO civil_properties (id, "caseId", "categoryId", "lhcNumber", "subCity", woreda, kebele, "houseNumber",
                              "landHoldingRight", "plotArea", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, ref.civil_category,
       'LHC/' || (ARRAY['AA','BD','HW','DD','MK'])[1 + (g.n % 5)] || '/' || lpad((g.n * 37 % 999999)::text, 6, '0'),
       (ARRAY['Bole','Yeka','Kirkos','Lideta','Arada','Kolfe Keranio','Nifas Silk-Lafto','Akaky Kaliti','Gulele','Addis Ketema'])[1 + (g.n % 10)],
       lpad((1 + g.n % 14)::text, 2, '0'), lpad((1 + g.n % 20)::text, 2, '0'), (100 + g.n % 900)::text,
       (ARRAY['FREEHOLD','LEASE'])[1 + (g.n % 2)]::"LandHoldingRight", round((120 + random() * 2000)::numeric, 2),
       c."createdAt", c."createdAt"
FROM valuation_cases c JOIN gen g ON g.id = c.id CROSS JOIN ref
WHERE c.discipline = 'CIVIL';

INSERT INTO mechanical_properties (id, "caseId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, c."createdAt", c."createdAt"
FROM valuation_cases c JOIN gen g ON g.id = c.id
WHERE c.discipline = 'MECHANICAL';

INSERT INTO vehicles (id, "propertyId", "itemNumber", "plateNumber", "chassisNumber", make, model, "manufactureYear",
                      condition, mileage, "createdAt", "updatedAt")
SELECT gen_random_uuid(), mp.id, i,
       (ARRAY['AA','OR','AM','TG','SD'])[1 + (abs(hashtext(mp.id::text)) % 5)] || '-' || (1 + i) || '-'
         || lpad((abs(hashtext(mp.id::text || i)) % 99999)::text, 5, '0'),
       'JTF' || upper(substr(md5(mp.id::text || i), 1, 14)),
       (ARRAY['Toyota','Isuzu','Sino','Volvo','Mercedes-Benz','Hyundai'])[1 + (abs(hashtext(mp.id::text || i)) % 6)],
       (ARRAY['Hilux','NPR','Howo','FH','Actros','HD78'])[1 + (abs(hashtext(mp.id::text || i)) % 6)],
       2008 + (abs(hashtext(mp.id::text || i)) % 17),
       (ARRAY['EXCELLENT','VERY_GOOD','GOOD','FAIR','POOR'])[1 + (abs(hashtext(mp.id::text || i)) % 5)]::"ConditionGrade",
       round((10000 + random() * 400000)::numeric, 0), mp."createdAt", mp."createdAt"
FROM mechanical_properties mp
JOIN gen g ON g.id = mp."caseId"
CROSS JOIN generate_series(1, 2) AS i
WHERE i = 1 OR g.n % 2 = 0;

COMMIT;

ANALYZE;

SELECT 'valuation_cases' AS "table", count(*) FROM valuation_cases
UNION ALL SELECT 'sla_records', count(*) FROM sla_records
UNION ALL SELECT 'workflow_history', count(*) FROM workflow_history
UNION ALL SELECT 'workflow_tasks', count(*) FROM workflow_tasks
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'civil_properties', count(*) FROM civil_properties
UNION ALL SELECT 'vehicles', count(*) FROM vehicles;
