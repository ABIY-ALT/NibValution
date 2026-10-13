import { Ban, Fingerprint, ShieldAlert, ShieldCheck, Stamp, Undo2 } from 'lucide-react';
import type { ApprovalEntry, SignatureEntry } from '@/server/application/signature-service';
import { Badge } from '@/components/ui/badge';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The approval decisions on a case and the signature over the approved
 * valuation (sections 17-19). Every entry is read from append-only records, and
 * the signature is re-verified on each view rather than trusted from when it
 * was made.
 */

const STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const LEVEL_LABELS: Record<string, string> = {
  CHECKER: 'Checker',
  MANAGER: 'Maker Manager',
  DIRECTOR: 'Director',
};

const DECISIONS: Record<
  string,
  { label: string; icon: typeof Stamp; tone: string; badge: 'success' | 'warning' | 'danger' }
> = {
  APPROVED: {
    label: 'Approved',
    icon: Stamp,
    tone: 'bg-st-done-bg text-st-done',
    badge: 'success',
  },
  RETURNED: {
    label: 'Returned',
    icon: Undo2,
    tone: 'bg-st-review-bg text-st-review',
    badge: 'warning',
  },
  REJECTED: { label: 'Rejected', icon: Ban, tone: 'bg-st-late-bg text-st-late', badge: 'danger' },
};

const CHECKS: Record<SignatureEntry['check'], { label: string; detail: string; good: boolean }> = {
  VALID: {
    label: 'Signature valid',
    detail:
      'The stored report re-hashes to the signed digest, and the signature checks against it.',
    good: true,
  },
  DOCUMENT_CHANGED: {
    label: 'Document altered',
    detail: 'The stored report no longer hashes to what was signed. Treat it as untrustworthy.',
    good: false,
  },
  INVALID: {
    label: 'Signature invalid',
    detail: 'The signature does not match the signed digest.',
    good: false,
  },
  UNKNOWN_KEY: {
    label: 'Signed with another key',
    detail: 'The signing key has since been rotated, so this server cannot check it.',
    good: false,
  },
  REVOKED: {
    label: 'Signature revoked',
    detail: 'The signature was revoked after it was made.',
    good: false,
  },
};

export function ApprovalRecordCard({
  approvals,
  signature,
}: {
  approvals: ApprovalEntry[];
  signature: SignatureEntry | null;
}) {
  const check = signature ? CHECKS[signature.check] : null;

  return (
    <Card className="overflow-hidden">
      <CardBar>
        <CardTitle className="flex items-center gap-3">
          <CardIcon icon={Stamp} />
          Approvals &amp; signature
        </CardTitle>
      </CardBar>
      <CardContent className="space-y-4 pt-6">
        {approvals.length > 0 ? (
          <ol className="space-y-3">
            {approvals.map((entry) => {
              const decision = DECISIONS[entry.decision] ?? DECISIONS.APPROVED!;
              const Icon = decision.icon;
              return (
                <li key={entry.id} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      decision.tone,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
                      {LEVEL_LABELS[entry.level] ?? entry.level}
                      <Badge size="sm" variant={decision.badge}>
                        {decision.label}
                      </Badge>
                    </p>
                    <p className="text-[12px] text-ink-3">
                      {entry.approver} · {STAMP.format(entry.decidedAt)}
                    </p>
                    <p className="tabular text-[12px] text-ink-2">
                      on {formatCurrency(entry.valueAtDecision)}
                    </p>
                    {entry.comment ? (
                      <p className="mt-1 text-[12.5px] text-ink-2 wrap-anywhere">{entry.comment}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {signature && check ? (
          <div
            className={cn(
              'rounded-(--radius-control) p-4',
              check.good ? 'bg-st-done-bg' : 'bg-st-late-bg',
            )}
          >
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              {check.good ? (
                <ShieldCheck className="h-4 w-4 text-st-done" aria-hidden="true" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-st-late" aria-hidden="true" />
              )}
              {check.label}
            </p>
            <p className="mt-1 text-[12px] text-ink-2">
              Signed by {signature.signer} ({signature.signerRole.toLowerCase().replace('_', ' ')}),{' '}
              {STAMP.format(signature.signedAt)} UTC
              {signature.reportVersion ? ` · report version ${signature.reportVersion}` : ''}
            </p>
            <p className="mt-1 text-[11.5px] text-ink-3">{check.detail}</p>
            <p
              className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-ink-3"
              title={signature.documentSha256}
            >
              <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
              {signature.documentSha256.slice(0, 16)}… · {signature.provider}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
