import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { serverEnv } from '@/lib/env';

/**
 * The single Prisma client for the application.
 *
 * Prisma 7 connects through a driver adapter, which means the connection pool
 * is ours to size. That is an advantage here rather than a chore: with roughly
 * 40 concurrent users against one PostgreSQL instance, an unbounded pool is a
 * reliable way to exhaust the server's connection slots during a report run.
 * The pool is deliberately modest and the statement timeout deliberately
 * finite, so a pathological query fails rather than holding a connection open.
 */

declare global {
  var __nibPrisma: PrismaClient | undefined;

  var __nibPgPool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  return new pg.Pool({
    connectionString: serverEnv.DATABASE_URL,
    max: serverEnv.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // A query that has run for a minute is not going to succeed; failing it
    // returns the connection to the pool instead of starving other users.
    statement_timeout: 60_000,
    query_timeout: 60_000,
    application_name: 'nib-valuation',
  });
}

function createClient(): PrismaClient {
  const pool = globalThis.__nibPgPool ?? createPool();
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__nibPgPool = pool;
  }

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });
}

/**
 * Reused across hot reloads in development. Without this, every reload leaks a
 * pool and the database runs out of connections within a few minutes of work.
 */
export const prisma: PrismaClient = globalThis.__nibPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__nibPrisma = prisma;
}

/** Prisma transaction client type, for functions that must run inside one. */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * Run work in a single transaction.
 *
 * Every workflow transition uses this: the status change, the workflow history
 * row, the SLA update and the audit record must commit or fail together, or the
 * audit trail can disagree with the case (rule 11).
 *
 * Notifications are deliberately *not* sent inside the callback - a failing
 * mail server must never roll back a legitimate approval.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: options?.timeoutMs ?? 15_000,
    maxWait: options?.maxWaitMs ?? 5_000,
  });
}

/** Liveness probe for the health endpoint. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
