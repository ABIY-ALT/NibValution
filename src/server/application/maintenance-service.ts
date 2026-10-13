import { purgeExpiredSessions } from '@/server/infrastructure/auth/session';

/**
 * Nightly housekeeping (roadmap Phase 8).
 *
 * Only disposable operational rows are removed: sessions that expired or were
 * revoked more than a week ago. Their token hashes are useless by then, and
 * the sign-in and sign-out events themselves stay in the audit log, which -
 * like cases, valuations, documents and notifications - this job never touches.
 */

export interface MaintenanceResult {
  sessionsPurged: number;
}

export async function runMaintenance(): Promise<MaintenanceResult> {
  const sessionsPurged = await purgeExpiredSessions(7);
  return { sessionsPurged };
}
