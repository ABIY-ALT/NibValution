import { NextResponse } from 'next/server';
import { checkDatabase } from '@/server/infrastructure/db/client';
import { logger } from '@/lib/logger';

/**
 * Liveness and readiness for the load balancer and monitoring (roadmap
 * Phase 8). Public, so it says only "up" or "down": no version, no host names,
 * no error text - the detail goes to the server log.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const db = await checkDatabase();
  if (!db.ok) {
    logger.error(
      { error: db.error, latencyMs: db.latencyMs },
      'Health check: database unreachable',
    );
    return NextResponse.json(
      { status: 'down', database: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { status: 'ok', database: 'ok', latencyMs: db.latencyMs },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
