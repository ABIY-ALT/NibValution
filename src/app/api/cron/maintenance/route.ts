import { NextResponse, type NextRequest } from 'next/server';
import { runMaintenance } from '@/server/application/maintenance-service';
import { refuseUnlessCron } from '@/lib/http/cron-auth';
import { logger } from '@/lib/logger';

/**
 * Nightly housekeeping (roadmap Phase 8): called once a day by the scheduler
 * with `Authorization: Bearer <CRON_SECRET>`. See `maintenance-service.ts` for
 * what it removes - and what it never touches.
 */

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest): Promise<NextResponse> {
  const refusal = refuseUnlessCron(request);
  if (refusal) return refusal;

  try {
    const result = await runMaintenance();
    logger.info({ ...result }, 'Scheduled maintenance');
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Scheduled maintenance failed');
    return NextResponse.json({ error: 'Maintenance failed; see the server log.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
