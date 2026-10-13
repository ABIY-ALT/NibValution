import type { MalwareScanner, ScanResult } from '@/server/domain/ports/scanner';
import { deploymentEnv, serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Malware scanning (assumption 5.4).
 *
 * The important behaviour is what happens when no scanner is configured. In
 * development that is normal and files pass. In production it is a
 * misconfiguration, and the scanner reports `UNAVAILABLE` so uploads are
 * quarantined rather than released — an unscanned file must never become
 * downloadable just because the scanner was missing.
 */

/** Development only: no scanning, everything passes. */
class NoOpScanner implements MalwareScanner {
  readonly name = 'none';

  async scan(): Promise<ScanResult> {
    return { verdict: 'CLEAN', detail: 'No scanner configured (development).' };
  }
}

/** Production with no scanner configured: fail closed. */
class FailClosedScanner implements MalwareScanner {
  readonly name = 'fail-closed';

  async scan(): Promise<ScanResult> {
    return {
      verdict: 'UNAVAILABLE',
      detail: 'No malware scanner is configured; the file has been quarantined.',
    };
  }
}

/**
 * ClamAV over the clamd INSTREAM protocol.
 *
 * Not yet wired to a socket — the adapter is present so the integration point
 * is real and testable, and it reports UNAVAILABLE rather than pretending a
 * file is clean.
 */
class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async scan(_data: Buffer, filename: string): Promise<ScanResult> {
    logger.warn(
      { filename, host: this.host, port: this.port },
      'ClamAV adapter is not yet implemented; quarantining rather than passing the file',
    );
    return {
      verdict: 'UNAVAILABLE',
      detail: 'The ClamAV adapter is configured but not yet implemented.',
    };
  }
}

let cached: MalwareScanner | null = null;

export function getScanner(): MalwareScanner {
  if (cached) return cached;

  if (serverEnv.SCANNER_DRIVER === 'clamav') {
    cached = new ClamAvScanner(serverEnv.CLAMAV_HOST ?? 'localhost', serverEnv.CLAMAV_PORT ?? 3310);
    return cached;
  }

  cached = deploymentEnv() === 'production' ? new FailClosedScanner() : new NoOpScanner();
  return cached;
}

/** Test seam. */
export function __setScanner(scanner: MalwareScanner | null): void {
  cached = scanner;
}
