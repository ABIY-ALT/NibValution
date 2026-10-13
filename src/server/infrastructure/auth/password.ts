import { randomBytes } from 'node:crypto';
import type { Algorithm } from '@node-rs/argon2';
import { logger } from '@/lib/logger';

/**
 * `Algorithm` is an ambient const enum, which `isolatedModules` forbids reading
 * at runtime. The numeric value is part of the library's public API
 * (Argon2d = 0, Argon2i = 1, Argon2id = 2) and is named here rather than left
 * implicit - a security parameter should be visible in the code, not inherited
 * from a default that could change between versions.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Password hashing (spec section 26, rule 5).
 *
 * Argon2id with OWASP-aligned parameters. The parameters are stored alongside
 * each hash so they can be raised later without invalidating existing
 * credentials: a user whose hash used weaker settings is transparently
 * re-hashed on their next successful login.
 */

export interface HashParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  algorithm: 'argon2id';
}

/** 19 MiB, 2 passes, 1 lane - the OWASP baseline for Argon2id. */
export const CURRENT_HASH_PARAMS: HashParams = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 'argon2id',
};

/**
 * Two implementations of the same Argon2id.
 *
 * The native module is the fast one, but it is an unsigned binary, and an
 * application-control policy (Windows Smart App Control, WDAC, AppLocker - all
 * common on bank machines) can refuse to load it. Then nobody could sign in.
 * The WebAssembly build runs inside Node, where no such policy reaches, and
 * reads and writes the same PHC strings (`$argon2id$v=19$m=...`), so a hash
 * made by either verifies with the other and no password has to be reset.
 */
interface Argon2Backend {
  readonly name: 'native' | 'wasm';
  hash(plaintext: string, params: HashParams): Promise<string>;
  verify(storedHash: string, plaintext: string): Promise<boolean>;
}

async function nativeBackend(): Promise<Argon2Backend> {
  const native = await import('@node-rs/argon2');
  return {
    name: 'native',
    hash: (plaintext, params) =>
      native.hash(plaintext, {
        algorithm: ARGON2ID,
        memoryCost: params.memoryCost,
        timeCost: params.timeCost,
        parallelism: params.parallelism,
      }),
    verify: (storedHash, plaintext) => native.verify(storedHash, plaintext),
  };
}

export async function wasmBackend(): Promise<Argon2Backend> {
  const wasm = await import('hash-wasm');
  return {
    name: 'wasm',
    hash: (plaintext, params) =>
      wasm.argon2id({
        password: plaintext,
        salt: randomBytes(16),
        parallelism: params.parallelism,
        iterations: params.timeCost,
        memorySize: params.memoryCost,
        hashLength: 32,
        outputType: 'encoded',
      }),
    verify: (storedHash, plaintext) => wasm.argon2Verify({ password: plaintext, hash: storedHash }),
  };
}

let backend: Promise<Argon2Backend> | null = null;

/** The native implementation where it loads, the WebAssembly one where it cannot. */
export function argon2Backend(): Promise<Argon2Backend> {
  backend ??= nativeBackend().catch(async (error: unknown) => {
    // The loader nests one error per candidate binary; somewhere in the chain
    // is the actual reason, usually a policy block. Log that line, not the chain.
    const messages: string[] = [];
    for (let e: unknown = error; e instanceof Error; e = e.cause) {
      messages.push(...e.message.split(/\r?\n/));
    }
    const blocked = messages.find((m) => /application control policy/i.test(m));
    logger.warn(
      { reason: (blocked ?? messages[0] ?? String(error)).slice(0, 200) },
      'Native Argon2 could not be loaded; using the WebAssembly implementation',
    );
    return wasmBackend();
  });
  return backend;
}

export async function hashPassword(
  plaintext: string,
  params: HashParams = CURRENT_HASH_PARAMS,
): Promise<{ hash: string; params: HashParams }> {
  const digest = await (await argon2Backend()).hash(plaintext, params);
  return { hash: digest, params };
}

/**
 * Verify a password. Never throws on a malformed stored hash - it returns
 * false, so a corrupted credential row is a failed login rather than a 500 that
 * distinguishes existing accounts from missing ones.
 */
export async function verifyPassword(plaintext: string, storedHash: string): Promise<boolean> {
  try {
    return await (await argon2Backend()).verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Serialise the parameters for storage next to the hash.
 *
 * A plain record rather than the interface, so it satisfies Prisma's JSON
 * input type without an unchecked cast at every call site.
 */
export function paramsToJson(params: HashParams): Record<string, string | number> {
  return {
    algorithm: params.algorithm,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  };
}

/** Should this hash be upgraded to the current parameters on next login? */
export function needsRehash(params: Partial<HashParams> | null | undefined): boolean {
  if (!params) return true;
  return (
    params.algorithm !== CURRENT_HASH_PARAMS.algorithm ||
    (params.memoryCost ?? 0) < CURRENT_HASH_PARAMS.memoryCost ||
    (params.timeCost ?? 0) < CURRENT_HASH_PARAMS.timeCost
  );
}

/**
 * Constant-time-ish dummy verification.
 *
 * Called when a login names an account that does not exist, so that the
 * response time does not reveal which usernames are real. Without it, an
 * attacker can enumerate valid employee IDs by timing alone.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$8Qz9L4rGZ5m1nHqTQ0kEXQoJ3wZ7cE8fF1qGx0YXVzQ';

export async function dummyVerify(plaintext: string): Promise<void> {
  await verifyPassword(plaintext, DUMMY_HASH);
}
