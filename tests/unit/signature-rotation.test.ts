import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalEcdsaProvider } from '@/server/infrastructure/signature';

/**
 * Signing-key rotation (runbook section 10). A bank rotates signing keys; the
 * reports signed before a rotation must keep verifying, which the retired
 * public keys make possible, and must be flagged when that key is not held.
 */

const newKey = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const digest = createHash('sha256').update('a frozen valuation report').digest('hex');

describe('signing-key rotation', () => {
  it('verifies a report signed before the rotation against the retired key', async () => {
    const oldKey = newKey();
    const before = new LocalEcdsaProvider(oldKey, []);
    const signed = await before.sign(digest);

    const after = new LocalEcdsaProvider(newKey(), [createPublicKey(oldKey)]);
    expect(await after.verify(digest, signed.signature, signed.keyFingerprint)).toBe('VALID');

    // New reports are signed with the new key, which also verifies.
    const fresh = await after.sign(digest);
    expect(fresh.keyFingerprint).not.toBe(signed.keyFingerprint);
    expect(await after.verify(digest, fresh.signature, fresh.keyFingerprint)).toBe('VALID');
  });

  it('reports an unknown key when the retired key was not kept', async () => {
    const oldKey = newKey();
    const signed = await new LocalEcdsaProvider(oldKey, []).sign(digest);
    const after = new LocalEcdsaProvider(newKey(), []);
    expect(await after.verify(digest, signed.signature, signed.keyFingerprint)).toBe('UNKNOWN_KEY');
  });

  it('still rejects an altered document under a retired key', async () => {
    const oldKey = newKey();
    const signed = await new LocalEcdsaProvider(oldKey, []).sign(digest);
    const after = new LocalEcdsaProvider(newKey(), [createPublicKey(oldKey)]);
    const altered = createHash('sha256').update('an altered report').digest('hex');
    expect(await after.verify(altered, signed.signature, signed.keyFingerprint)).toBe('INVALID');
  });
});
