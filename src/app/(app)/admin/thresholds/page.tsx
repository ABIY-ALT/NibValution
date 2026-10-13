import { AlertTriangle, CheckCircle2, GitBranch, Info, PenLine } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listApprovalConfiguration } from '@/server/application/admin-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  EmptyRow,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/money';
import { ROLE_LABELS, type RoleCode } from '@/server/domain/shared/enums';
import { ThresholdChainForm } from './threshold-chain-form';

export const dynamic = 'force-dynamic';

function band(min: unknown, max: unknown): string {
  const from = formatCurrency(String(min));
  if (max === null || max === undefined) return `${from} and above`;
  return `${from} up to (but not including) ${formatCurrency(String(max))}`;
}

export default async function ThresholdsPage() {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.THRESHOLD_UPDATE)) {
    return <AccessDenied permission="threshold:update" what="approval thresholds" />;
  }
  const { thresholds, letterRules, validationError } = await listApprovalConfiguration(actor);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Approval Thresholds"
        subtitle="Two independent ladders. Approval routing decides who must sign off on a valuation; final-letter authority decides who issues the letter. The source specification sets them at different amounts, so they are configured separately."
        actions={
          <Badge variant={validationError ? 'danger' : 'success'} size="lg">
            {validationError ? 'Configuration invalid' : 'Configuration valid'}
          </Badge>
        }
      />

      {validationError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>The live approval ladder is not usable</AlertTitle>
          <AlertDescription>
            {validationError} Cases cannot be routed for approval until this is corrected.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Configuration is valid</AlertTitle>
          <AlertDescription>
            The bands cover every amount from zero upwards with no gap and no overlap, and the
            highest band is unbounded.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <TableWrap>
          <TableBar>
            <TableTitle>
              <GitBranch className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Approval routing
            </TableTitle>
            <Badge variant="default">{thresholds.length} bands</Badge>
          </TableBar>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Band</TH>
                  <TH>Amount range</TH>
                  <TH>Approval chain</TH>
                  <TH>In force from</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Edit chain</TH>
                </TR>
              </THead>
              <TBody>
                {thresholds.length === 0 ? (
                  <EmptyRow colSpan={6} icon={GitBranch} title="No bands configured">
                    No approval bands have been defined.
                  </EmptyRow>
                ) : (
                  thresholds.map((threshold) => {
                    const chain = (threshold.approvalChain as RoleCode[]) ?? [];
                    return (
                      <TR key={threshold.id}>
                        <TD className="text-[13px] font-semibold text-ink">{threshold.name}</TD>
                        <TD className="tabular text-[12px]">
                          {band(threshold.minAmount, threshold.maxAmount)}
                        </TD>
                        <TD>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {chain.map((role, index) => (
                              <span key={role} className="flex items-center gap-1.5">
                                {index > 0 ? (
                                  <span className="text-ink-3" aria-hidden="true">
                                    →
                                  </span>
                                ) : null}
                                <Badge variant="brand" size="sm">
                                  {ROLE_LABELS[role] ?? role}
                                </Badge>
                              </span>
                            ))}
                          </div>
                        </TD>
                        <TD className="tabular whitespace-nowrap text-[12px]">
                          {threshold.effectiveFrom.toISOString().slice(0, 10)}
                          {threshold.effectiveTo ? (
                            <span className="block text-[11px] text-ink-3">
                              until {threshold.effectiveTo.toISOString().slice(0, 10)}
                            </span>
                          ) : null}
                        </TD>
                        <TD>
                          <Badge variant={threshold.isActive ? 'success' : 'inactive'} size="sm">
                            {threshold.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TD>
                        <TD>
                          <div className="flex justify-end">
                            <ThresholdChainForm thresholdId={threshold.id} chain={chain} />
                          </div>
                        </TD>
                      </TR>
                    );
                  })
                )}
              </TBody>
            </Table>
          </TableScroll>
        </TableWrap>

        <p className="px-1 text-[11.5px] leading-relaxed text-ink-3">
          Chains are cumulative and ordered. A chain of only CHECKER means checking finalises the
          valuation. Approving out of order is refused by the server, so a Director sign-off cannot
          substitute for the Manager review the policy requires.
        </p>
      </div>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <PenLine className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Final-letter authority
          </TableTitle>
          <Badge variant="default">{letterRules.length} bands</Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Band</TH>
                <TH>Amount range</TH>
                <TH>Issued by</TH>
                <TH>In force from</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {letterRules.length === 0 ? (
                <EmptyRow colSpan={5} icon={PenLine} title="No letter rules">
                  No final-letter authority bands have been defined.
                </EmptyRow>
              ) : (
                letterRules.map((rule) => (
                  <TR key={rule.id}>
                    <TD className="text-[13px] font-semibold text-ink">{rule.name}</TD>
                    <TD className="tabular text-[12px]">{band(rule.minAmount, rule.maxAmount)}</TD>
                    <TD>
                      <Badge variant="accent" size="sm">
                        {ROLE_LABELS[rule.issuerRole as RoleCode] ?? rule.issuerRole}
                      </Badge>
                    </TD>
                    <TD className="tabular whitespace-nowrap text-[12px]">
                      {rule.effectiveFrom.toISOString().slice(0, 10)}
                    </TD>
                    <TD>
                      <Badge variant={rule.isActive ? 'success' : 'inactive'} size="sm">
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Why the two ladders differ</AlertTitle>
        <AlertDescription>
          A case at ETB 90 million needs Director <em>approval</em> (80 million and above) but the
          Maker Manager still issues the <em>letter</em> (below 100 million). Conflating the two
          would put the wrong signature on the letter, so they are stored and resolved separately.
          Both are temporal: a case is always judged against the rules in force on its request date,
          so raising a threshold cannot make last year&apos;s approvals look non-compliant.
        </AlertDescription>
      </Alert>
    </div>
  );
}
