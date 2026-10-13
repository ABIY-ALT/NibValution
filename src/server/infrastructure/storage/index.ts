import type { StorageProvider } from '@/server/domain/ports/storage';
import { LocalStorageProvider } from './local-storage';
import { serverEnv } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';

/**
 * Storage selection.
 *
 * Chosen once from configuration. Adding an S3 or SMB driver means implementing
 * `StorageProvider` and adding a case here — no caller changes, because no
 * caller ever knew where the bytes were going.
 */

let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (cached) return cached;

  switch (serverEnv.STORAGE_DRIVER) {
    case 'local':
      cached = new LocalStorageProvider();
      return cached;
    case 's3':
      // Deliberately explicit rather than silently falling back to local
      // storage: a production deployment that believes it is writing to object
      // storage must not quietly write to a container filesystem instead.
      throw new ConfigurationError(
        'The S3 storage driver is configured but not yet implemented. ' +
          'Set STORAGE_DRIVER=local, or implement StorageProvider for S3.',
      );
    default:
      throw new ConfigurationError(`Unknown storage driver "${serverEnv.STORAGE_DRIVER}".`);
  }
}

/** Test seam. */
export function __setStorage(provider: StorageProvider | null): void {
  cached = provider;
}

export const QUARANTINE_PREFIX = 'quarantine';
export const DOCUMENTS_PREFIX = 'documents';
