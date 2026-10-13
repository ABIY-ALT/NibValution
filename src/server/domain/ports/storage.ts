/**
 * Storage abstraction (spec section 8).
 *
 * Callers address objects only by the opaque key this interface returns. No
 * caller ever builds a path, and no path is ever returned to a client — which
 * is what makes rule 6 ("do not expose uploaded-file physical paths")
 * structurally true rather than a habit someone has to remember.
 */

export interface StoredObject {
  /** Opaque, random, provider-specific. Meaningless to a client. */
  readonly key: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface StorageProvider {
  readonly name: string;

  /**
   * Persist bytes and return the key they were stored under.
   *
   * The caller proposes a *prefix* only (for example `quarantine` or a case
   * id); the provider chooses the final name, so a caller cannot influence the
   * path and path traversal has nowhere to enter.
   */
  put(prefix: string, data: Buffer, contentType: string): Promise<StoredObject>;

  get(key: string): Promise<Buffer>;

  /** Move an object between prefixes, e.g. quarantine → permanent. */
  move(fromKey: string, toPrefix: string): Promise<string>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}

/** Thrown when a key is not a key this provider issued. */
export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Refusing to use a storage key that this application did not issue: "${key}".`);
    this.name = 'StorageKeyError';
  }
}
