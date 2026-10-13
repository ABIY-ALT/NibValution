import { describe, expect, it } from 'vitest';
import {
  CURRENT_HASH_PARAMS,
  argon2Backend,
  dummyVerify,
  hashPassword,
  verifyPassword,
  wasmBackend,
} from '@/server/infrastructure/auth/password';

/**
 * Password hashing (spec section 26, rule 5; roadmap Phase 8).
 *
 * Whichever Argon2id implementation loads - native, or WebAssembly where an
 * application-control policy blocks the native binary - must produce and
 * accept the same PHC strings, so switching never forces a password reset.
 */

const PASSWORD = 'Correct-Horse#Battery-2026';

describe('password hashing', () => {
  it('hashes with Argon2id at the current parameters and verifies', async () => {
    const { hash, params } = await hashPassword(PASSWORD);
    expect(params).toEqual(CURRENT_HASH_PARAMS);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, hash)).toBe(false);
  });

  it('salts every hash, so equal passwords do not produce equal hashes', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a.hash).not.toBe(b.hash);
  });

  it('accepts hashes across implementations in both directions', async () => {
    const active = await argon2Backend();
    const wasm = await wasmBackend();
    const byActive = await active.hash(PASSWORD, CURRENT_HASH_PARAMS);
    const byWasm = await wasm.hash(PASSWORD, CURRENT_HASH_PARAMS);
    expect(await wasm.verify(byActive, PASSWORD)).toBe(true);
    expect(await active.verify(byWasm, PASSWORD)).toBe(true);
  });

  it('treats a malformed stored hash as a failed login, not an error', async () => {
    expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
    expect(await verifyPassword(PASSWORD, '')).toBe(false);
  });

  it('spends real hashing time on an unknown account, so timing reveals nothing', async () => {
    const { hash } = await hashPassword(PASSWORD);
    await verifyPassword(PASSWORD, hash); // warm up

    let started = performance.now();
    await verifyPassword(PASSWORD, hash);
    const real = performance.now() - started;

    started = performance.now();
    await dummyVerify(PASSWORD);
    const dummy = performance.now() - started;

    // Same parameters, same work: a dummy that returned at once would be an
    // account-enumeration oracle.
    expect(dummy).toBeGreaterThan(real * 0.3);
  });
});