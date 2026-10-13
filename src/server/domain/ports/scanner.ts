/**
 * Malware scanning (spec sections 8 and 26).
 *
 * The interface is deliberately small so a real scanner can be dropped in
 * without touching upload logic. What matters is the contract around failure:
 * a scan that cannot be performed is **not** a pass.
 */

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'UNAVAILABLE';

export interface ScanResult {
  readonly verdict: ScanVerdict;
  /** Signature name, or the reason the scan could not run. */
  readonly detail: string | null;
}

export interface MalwareScanner {
  readonly name: string;
  /** Never throws for an infected file — an infection is a verdict, not an error. */
  scan(data: Buffer, filename: string): Promise<ScanResult>;
}

/**
 * Map a verdict to the status a document is stored with.
 *
 * `UNAVAILABLE` quarantines rather than releases. That is the whole point of
 * fail-closed: if the bank's scanner is down, an unscanned file must not
 * silently become downloadable.
 */
export function statusForVerdict(verdict: ScanVerdict): 'CLEAN' | 'INFECTED' | 'QUARANTINED' {
  switch (verdict) {
    case 'CLEAN':
      return 'CLEAN';
    case 'INFECTED':
      return 'INFECTED';
    case 'UNAVAILABLE':
      return 'QUARANTINED';
  }
}
