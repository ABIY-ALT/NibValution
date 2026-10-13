-- Phase 8: indexes for the "newest first" lists, measured against 50,000 cases
-- and 500,000 audit rows (docs/09-performance-and-load.md).
--
-- Each list below was sorting its whole candidate set to show one page:
--   audit log, newest 50           parallel seq scan of every row      77 ms
--   a user's notifications         32,000 rows gathered, then sorted   18 ms
--   a branch's cases               seq scan                            23 ms
--   the department's cases         parallel seq scan                   44 ms
-- With the index each reads only the rows it shows.

CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

CREATE INDEX "notifications_recipientId_createdAt_idx" ON "notifications"("recipientId", "createdAt");

CREATE INDEX "valuation_cases_requestingOrgId_createdAt_idx" ON "valuation_cases"("requestingOrgId", "createdAt");

CREATE INDEX "valuation_cases_departmentId_createdAt_idx" ON "valuation_cases"("departmentId", "createdAt");
