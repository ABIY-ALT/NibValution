import { NextResponse, type NextRequest } from 'next/server';
import { refreshSla } from '@/server/application/sla-service';
import { refuseUnlessCron } from '@/lib/http/cron-auth';
import { logger } from '@/lib/logger';

/**
 * Scheduled SLA sweep (roadmap Phase 7).
 *
 * The sweep also runs on page loads, but a quiet night has no page loads, so a
 * scheduler (cron, Windows Task Scheduler, the platform's jobs) calls this
 * every 15 minutes with `Authorization: Bearer <CRON_SECRET>`. With no secret
 * configured the endpoint does not exist, rather than being open.
 */

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest): Promise<NextResponse> {
  const refusal = refuseUnlessCron(request);
  if (refusal) return refusal;

  try {
    const result = await refreshSla();
    logger.info({ ...result }, 'Scheduled SLA sweep');
    return NextResponse.json({
      evaluated: result.evaluated,
      changed: result.changed,
      approaching: result.approaching.length,
      breached: result.breached.length,
    });
  } catch (error) {
    logger.error({ err: error }, 'Scheduled SLA sweep failed');
    return NextResponse.json({ error: 'The sweep failed; see the server log.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
