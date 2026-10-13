/**
 * Digital signatures (spec section 19; assumption 5.2).
 *
 * The workflow signs a document's SHA-256 digest through this port and never
 * handles key material itself. The default implementation signs with a local
 * ECDSA P-256 key; an adapter for the bank's PKI, HSM or national signature
 * service replaces it without any change to workflow code.
 */

export interface SignatureResult {
  /** Base64 DER signature over the digest. */
  readonly signature: string;
  /** Identifies the key that signed: SHA-256 of its public key, hex. */
  readonly keyFingerprint: string;
}

export type SignatureCheck = 'VALID' | 'INVALID' | 'UNKNOWN_KEY';

export interface SignatureProvider {
  /** Stored with each signature, e.g. `local-ecdsa-p256`. */
  readonly name: string;
  sign(documentSha256: string): Promise<SignatureResult>;
  /**
   * `UNKNOWN_KEY` when the signature was made by a key this provider does not
   * hold (for example after a key rotation) - neither valid nor forged, just
   * not checkable here.
   */
  verify(
    documentSha256: string,
    signature: string,
    keyFingerprint: string,
  ): Promise<SignatureCheck>;
}
