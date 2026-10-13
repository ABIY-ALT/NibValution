-- Restore verification (runbook, section "Backup and restore").
--
-- Run against the source and against the restored copy, and compare the two
-- outputs; they must be identical. Read-only apart from the protection probes,
-- each of which is rolled back.
--
--   psql -d nib_valuation          -At -f scripts/ops/verify-restore.sql > source.txt
--   psql -d nib_valuation_restore  -At -f scripts/ops/verify-restore.sql > restored.txt
--   diff source.txt restored.txt

\set ON_ERROR_STOP on
\pset footer off

\echo '# row counts'
SELECT format('%s %s', t, n) FROM (
  SELECT 'valuation_cases' AS t, count(*) AS n FROM valuation_cases
  UNION ALL SELECT 'valuations', count(*) FROM valuations
  UNION ALL SELECT 'calculation_runs', count(*) FROM calculation_runs
  UNION ALL SELECT 'approvals', count(*) FROM approvals
  UNION ALL SELECT 'reports', count(*) FROM reports
  UNION ALL SELECT 'digital_signatures', count(*) FROM digital_signatures
  UNION ALL SELECT 'property_documents', count(*) FROM property_documents
  UNION ALL SELECT 'workflow_history', count(*) FROM workflow_history
  UNION ALL SELECT 'workflow_tasks', count(*) FROM workflow_tasks
  UNION ALL SELECT 'sla_records', count(*) FROM sla_records
  UNION ALL SELECT 'notifications', count(*) FROM notifications
  UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
  UNION ALL SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'credentials', count(*) FROM credentials
  UNION ALL SELECT 'valuation_parameters', count(*) FROM valuation_parameters
  UNION ALL SELECT '_prisma_migrations', count(*) FROM _prisma_migrations
) c ORDER BY t;

\echo '# content fingerprints'
-- Hashes over identifying columns: equal counts with different content would
-- still differ here.
SELECT 'cases ' || md5(string_agg("caseNumber" || ':' || status || ':' || coalesce("finalValue"::text, '-'), ',' ORDER BY "caseNumber"))
FROM valuation_cases;
SELECT 'audit ' || md5(string_agg(id::text, ',' ORDER BY id)) FROM audit_logs;
SELECT 'reports ' || coalesce(md5(string_agg(sha256, ',' ORDER BY id)), 'none') FROM reports;
SELECT 'documents ' || coalesce(md5(string_agg(sha256 || storageKey, ',' ORDER BY id)), 'none')
FROM (SELECT id, sha256, "storageKey" AS storageKey FROM property_documents) d;

\echo '# protections present'
SELECT format('trigger %s.%s', event_object_table, trigger_name)
FROM information_schema.triggers WHERE trigger_schema = 'public'
GROUP BY event_object_table, trigger_name ORDER BY 1;
SELECT format('check %s.%s', conrelid::regclass, conname)
FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY 1;
SELECT format('index %s', indexname) FROM pg_indexes
WHERE schemaname = 'public' AND (indexname LIKE '%trgm' OR indexname LIKE '%open%') ORDER BY 1;

\echo '# protections enforced'
-- A restore that lost a trigger would leave history silently editable, so each
-- protection is probed: the change is attempted and must be refused. Should one
-- be accepted, the block raises, the change rolls back and the script stops.
DO $$
DECLARE
  refused boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM audit_logs) THEN
    refused := false;
    BEGIN
      UPDATE audit_logs SET action = action WHERE id = (SELECT id FROM audit_logs LIMIT 1);
    EXCEPTION WHEN others THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'audit_logs accepted an UPDATE'; END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM workflow_history) THEN
    refused := false;
    BEGIN
      DELETE FROM workflow_history WHERE id = (SELECT id FROM workflow_history LIMIT 1);
    EXCEPTION WHEN others THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'workflow_history accepted a DELETE'; END IF;
  END IF;
END $$;
SELECT 'audit_logs and workflow_history refuse changes (probed)';

\echo '# migrations'
SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name;
