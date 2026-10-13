import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/env';

/**
 * The gate in front of every `/api/cron/*` job.
 *
 * A scheduler presents `Authorization: Bearer <CRON_SECRET>`. With no secret
 * configured the endpoints do not exist (404), rather than being open; a wrong
 * secret is refused. Returns the refusal to send, or `null` to proceed.
 */
export function refuseUnlessCron(request: Request): NextResponse | null {
  const secret = serverEnv.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const header = request.headers.get('authorization') ?? '';
  const presented = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secret);
  // Constant-time, so the comparison leaks nothing about how close a guess was.
  const ok = presented.length === expected.length && timingSafeEqual(presented, expected);
  return ok ? null : NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
}
