import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SignatureCheck,
  SignatureProvider,
  SignatureResult,
} from '@/server/domain/ports/signature';
import { isProduction, serverEnv } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Signature provider selection (assumption 5.2).
 *
 * `local` signs with an ECDSA P-256 key - a standard algorithm through Node's
 * crypto module, deliberately not a hand-rolled scheme. In production the key
 * must be supplied (the environment check refuses to start without it, and
 * `SIGNATURE_LOCAL_PRIVATE_KEY` should be fed from a KMS or secret store). In
 * development and test, a key is generated once into `keys/`, which is kept
 * out of version control, so signatures stay verifiable across restarts.
 */

const DEV_KEY_PATH = join(process.cwd(), 'keys', 'dev-signing-key.pem');

function loadPrivateKey(): KeyObject {
  const configured = serverEnv.SIGNATURE_LOCAL_PRIVATE_KEY;
  if (configured) {
    // A PEM held in an environment variable usually arrives with escaped newlines.
    return createPrivateKey(configured.replace(/\\n/g, '\n'));
  }
  if (isProduction()) {
    throw new ConfigurationError(
      'No signing key is configured. Set SIGNATURE_LOCAL_PRIVATE_KEY from the secret store.',
    );
  }
  if (!existsSync(DEV_KEY_PATH)) {
    mkdirSync(dirname(DEV_KEY_PATH), { recursive: true });
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(DEV_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      mode: 0o600,
    });
  }
  return createPrivateKey(readFileSync(DEV_KEY_PATH));
}

/**
 * Public keys of retired signing keys, kept so that reports signed before a key
 * rotation still verify. Verification only: nothing is ever signed with them.
 */
function loadRetiredPublicKeys(): KeyObject[] {
  const configured = serverEnv.SIGNATURE_RETIRED_PUBLIC_KEYS;
  if (!configured) return [];
  // Escaped newlines, as in SIGNATURE_LOCAL_PRIVATE_KEY above.
  const pems = configured
    .replace(/\\n/g, '\n')
    .match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g);
  return (pems ?? []).map((pem) => createPublicKey(pem));
}

export function fingerprintOf(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

export class LocalEcdsaProvider implements SignatureProvider {
  readonly name = 'local-ecdsa-p256';
  private readonly privateKey: KeyObject;
  private readonly fingerprint: string;
  /** The current key and every retired one, by fingerprint. */
  private readonly verifiers = new Map<string, KeyObject>();

  constructor(
    privateKey: KeyObject = loadPrivateKey(),
    retired: KeyObject[] = loadRetiredPublicKeys(),
  ) {
    this.privateKey = privateKey;
    const publicKey = createPublicKey(this.privateKey);
    this.fingerprint = fingerprintOf(publicKey);
    for (const key of retired) this.verifiers.set(fingerprintOf(key), key);
    this.verifiers.set(this.fingerprint, publicKey);
  }

  async sign(documentSha256: string): Promise<SignatureResult> {
    const signature = sign('sha256', Buffer.from(documentSha256, 'hex'), {
      key: this.privateKey,
      dsaEncoding: 'der',
    });
    return { signature: signature.toString('base64'), keyFingerprint: this.fingerprint };
  }

  async verify(
    documentSha256: string,
    signature: string,
    keyFingerprint: string,
  ): Promise<SignatureCheck> {
    const publicKey = this.verifiers.get(keyFingerprint);
    if (!publicKey) return 'UNKNOWN_KEY';
    const ok = verify(
      'sha256',
      Buffer.from(documentSha256, 'hex'),
      { key: publicKey, dsaEncoding: 'der' },
      Buffer.from(signature, 'base64'),
    );
    return ok ? 'VALID' : 'INVALID';
  }
}

let provider: SignatureProvider | null = null;

export function getSignatureProvider(): SignatureProvider {
  if (provider) return provider;
  switch (serverEnv.SIGNATURE_PROVIDER) {
    case 'local':
      provider = new LocalEcdsaProvider();
      return provider;
    case 'external':
      // The adapter for the bank's PKI / HSM plugs in here once NIB names the
      // infrastructure (open question 5.2). Failing loudly beats signing with
      // something the bank has not approved.
      throw new ConfigurationError(
        'The external signature provider is not connected yet. Use SIGNATURE_PROVIDER=local until it is.',
      );
    default:
      throw new ConfigurationError(
        `Unknown signature provider "${String(serverEnv.SIGNATURE_PROVIDER)}".`,
      );
  }
}

/** Tests substitute a provider; `null` restores the configured one. */
export function __setSignatureProvider(replacement: SignatureProvider | null): void {
  provider = replacement;
}
