import { RateLimitedError } from '@/lib/errors';

/**
 * Fixed-window rate limiting for authentication endpoints.
 *
 * In-process and therefore per-instance. That is a deliberate, bounded choice:
 * the durable protection against credential stuffing is the *account* lockout,
 * which lives in the database and is shared by every instance. This limiter
 * exists to blunt rapid bursts from a single source, and it is honest about
 * being best-effort.
 *
 * If the deployment ever runs more than one application instance, swap the map
 * for Redis behind this same interface - no call site changes.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Bound the map so a flood of distinct keys cannot exhaust memory.
const MAX_TRACKED_KEYS = 10_000;

function prune(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still full of live windows: drop the oldest to stay bounded.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const oldest = [...windows.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt)
      .slice(0, 1000);
    for (const [key] of oldest) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  prune(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

export function assertRateLimit(key: string, limit: number, windowSeconds: number): void {
  const result = checkRateLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new RateLimitedError(result.retryAfterSeconds);
  }
}

/** Clear a key after a successful attempt, so a legitimate user is not penalised. */
export function resetRateLimit(key: string): void {
  windows.delete(key);
}

/** Test hook. */
export function __clearAllRateLimits(): void {
  windows.clear();
}
