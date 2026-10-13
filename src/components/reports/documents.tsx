import Image from 'next/image';
import { WorkingTables } from '@/components/valuation/valuation-breakdown';
import { formatAmount, formatCurrency } from '@/lib/money';
import { cn } from '@/lib/utils';
import { SITE_VISIT_CHECKS, type SiteVisitCheck } from '@/server/domain/shared/enums';
import {
  SiteVisitCheckBadge,
  photoLocation,
  photoUrl,
} from '@/components/valuation/site-visit-check';

/**
 * The case documents, rendered from their frozen snapshots (Phase 6).
 *
 * Nothing here reads the database: each document takes only the snapshot it
 * was issued with, which is what makes an old document reproduce exactly. The
 * shapes below mirror what case-document-service and signature-service store.
 */

type Doc = Record<string, unknown>;
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Doc) : {});
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as Doc[]) : []);

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });
const STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function date(value: unknown): string {
  const s = str(value);
  if (!s) return '—';
  const parsed = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(parsed.getTime()) ? s : DATE.format(parsed);
}

function stamp(value: unknown): string {
  const s = str(value);
  if (!s) return '—';
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? s : `${STAMP.format(parsed)} UTC`;
}

function money(value: unknown, currency: unknown): string {
  const s = str(value);
  return s ? formatCurrency(s, str(currency) ?? 'ETB') : '—';
}

const ROLE_LABELS: Record<string, string> = {
  CHECKER: 'Checker',
  MAKER_MANAGER: 'Maker Manager',
  MANAGER: 'Maker Manager',
  DIRECTOR: 'Director',
  ADMIN: 'Administrator',
};
const role = (value: unknown) => ROLE_LABELS[String(value)] ?? String(value ?? '—');

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Letterhead({
  title,
  department,
  reference,
  dated,
}: {
  title: string;
  department: string | null;
  reference: string | null;
  dated: string;
}) {
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-nib-gold-500 pb-5">
      <div className="flex items-center gap-3">
        <Image src="/nib-logo.png" alt="" width={52} height={52} className="shrink-0" />
        <div>
          <p className="text-[16px] font-extrabold leading-tight text-nib-brown-900">
            NIB International Bank S.C.
          </p>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-nib-gold-700">
            {department ?? 'Property Valuation Department'}
          </p>
        </div>
      </div>
      <div className="text-right text-[11.5px] leading-relaxed text-ink-2">
        <p className="text-[13px] font-bold text-ink">{title}</p>
        {reference ? <p>Ref. {reference}</p> : null}
        <p>{dated}</p>
      </div>
    </header>
  );
}

function Particulars({ rows }: { rows: [string, string | null][] }) {
  return (
    <dl className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
      {rows
        .filter(([, value]) => value !== null && value !== '')
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-3">{label}</dt>
            <dd className="font-medium text-ink wrap-anywhere">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 border-b border-line pb-1 text-[12px] font-bold uppercase tracking-[0.12em] text-nib-gold-700">
      {children}
    </h2>
  );
}

function Figures({
  market,
  forced,
  currency,
}: {
  market: unknown;
  forced: unknown;
  currency: unknown;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-(--radius-control) bg-nib-gold-500/12 p-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-2">
          Market value
        </p>
        <p className="mt-1 text-[22px] font-bold text-nib-gold-800">{money(market, currency)}</p>
      </div>
      <div className="rounded-(--radius-control) bg-surface-2 p-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-2">
          Forced-sale value
        </p>
        <p className="mt-1 text-[22px] font-bold text-ink">{money(forced, currency)}</p>
      </div>
    </div>
  );
}

function propertyRows(property: Doc): [string, string | null][] {
  if (property.kind === 'CIVIL') {
    return [
      ['Category', str(property.category)],
      ['Location', str(property.location)],
      ['LHC number', str(property.lhcNumber)],
      ['Land holding', str(property.landHoldingRight)],
      ['Plot area', str(property.plotArea) ? `${str(property.plotArea)} m²` : null],
      [
        'Buildings',
        property.buildingCount !== undefined
          ? `${String(property.buildingCount)}${str(property.buildingArea) ? `, ${str(property.buildingArea)} m² gross` : ''}`
          : null,
      ],
    ];
  }
  if (property.kind === 'MECHANICAL') {
    return [
      ['Plant / fleet', str(property.plantName)],
      ['Location', str(property.location)],
      [
        'Items',
        `${String(property.vehicleCount ?? 0)} vehicle(s), ${String(property.machineryCount ?? 0)} machine(s)`,
      ],
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Cover page (section 15)
// ---------------------------------------------------------------------------

export function CoverPageDocument({ doc, fingerprint }: { doc: Doc; fingerprint: string | null }) {
  const c = obj(doc.case);
  const v = obj(doc.valuation);
  const route = arr(doc.approvalRoute).map((r) => role(r));

  return (
    <div>
      <Letterhead
        title="Valuation Cover Page"
        department={str(c.department)}
        reference={str(c.caseNumber)}
        dated={date(doc.generatedAt)}
      />

      <Heading>Request</Heading>
      <Particulars
        rows={[
          ['Case number', str(c.caseNumber)],
          ['Request type', str(c.requestType)],
          ['Discipline', str(c.discipline)],
          ['Requesting unit', str(c.requestingUnit)],
          ['Property owner', str(c.owner)],
          ['Applicant', str(c.applicant)],
          ['Purpose', str(c.purpose)],
          ['Requested', date(c.requestedAt)],
        ]}
      />

      <Heading>Property</Heading>
      <Particulars rows={propertyRows(obj(doc.property))} />

      <Heading>Valuation</Heading>
      <Figures market={v.marketValue} forced={v.forcedSaleValue} currency={v.currency} />
      <div className="mt-3">
        <Particulars
          rows={[
            ['Valuation date', date(v.valuationDate)],
            ['Valuation version', v.version !== undefined ? String(v.version) : null],
            ['Parameter set', str(v.parameterSet)],
            ['Formula', str(v.formulaVersion)],
          ]}
        />
      </div>

      <Heading>Preparation and approval</Heading>
      <Particulars
        rows={[
          ['Prepared by', str(doc.preparedBy)],
          ['Checked by', str(doc.checkedBy)],
          ['Checked on', stamp(doc.checkedAt)],
          ['Approval route', route.length > 0 ? route.join(' → ') : 'Approved on checking'],
        ]}
      />

      <DocumentFooter
        lines={[`Generated by ${str(doc.generatedBy) ?? '—'}, ${stamp(doc.generatedAt)}`]}
        fingerprint={fingerprint}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site inspection - part of the signed valuation report
// ---------------------------------------------------------------------------

const asCheck = (value: unknown): SiteVisitCheck | null =>
  (SITE_VISIT_CHECKS as readonly string[]).includes(String(value))
    ? (value as SiteVisitCheck)
    : null;

/**
 * The visits and their photos, as frozen at signing. Reports signed before
 * site inspections were recorded have none, and show no section.
 */
function SiteInspection({ visits }: { visits: Doc[] }) {
  if (visits.length === 0) return null;
  return (
    <>
      <Heading>Site inspection</Heading>
      <ol className="space-y-4">
        {visits.map((visit, index) => {
          const check = asCheck(visit.check);
          const photos = arr(visit.photos);
          const latitude = str(visit.latitude);
          const longitude = str(visit.longitude);
          return (
            <li key={index} className="space-y-2 break-inside-avoid">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="font-semibold">{stamp(visit.visitedAt)}</span>
                <span>{str(visit.visitedBy)}</span>
                <span className="text-ink-3">
                  {visit.accessGained === false ? 'No access' : 'Inspected'}
                </span>
                {check ? (
                  <SiteVisitCheckBadge check={check} distanceMeters={str(visit.distanceMeters)} />
                ) : null}
              </div>
              {latitude && longitude ? (
                <p className="text-[11.5px] text-ink-3">
                  GPS {latitude}, {longitude}
                  {str(visit.accuracyMeters)
                    ? ` (±${Math.round(Number(visit.accuracyMeters))} m)`
                    : ''}
                </p>
              ) : null}
              {str(visit.findings) ? (
                <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2 wrap-anywhere">
                  {str(visit.findings)}
                </p>
              ) : null}
              {photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo) => {
                    const id = str(photo.id);
                    if (!id) return null;
                    const where = photoLocation(
                      asCheck(photo.check),
                      str(photo.distanceMeters),
                      str(photo.accuracyMeters),
                    );
                    return (
                      <figure key={id} className="break-inside-avoid">
                        {/* An authorised API route, not a static asset next/image could optimise. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photoUrl(id)}
                          alt={`Site photograph taken ${stamp(photo.takenAt)}`}
                          loading="lazy"
                          className="aspect-4/3 w-full rounded-sm bg-surface-2 object-cover"
                        />
                        <figcaption className="mt-1 text-[10.5px] leading-snug text-ink-3">
                          {stamp(photo.takenAt)} ·{' '}
                          <span className={where.flagged ? 'font-semibold text-st-late' : ''}>
                            {where.text}
                          </span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---------------------------------------------------------------------------
// Valuation report (signed, section 19)
// ---------------------------------------------------------------------------

export function ValuationReportDocument({
  doc,
  fingerprint,
  signatureStatus,
}: {
  doc: Doc;
  fingerprint: string | null;
  signatureStatus: string | null;
}) {
  const c = obj(doc.case);
  const v = obj(doc.valuation);
  const calc = obj(doc.calculation);
  const signer = obj(doc.signer);
  const approvals = arr(doc.approvals);
  const engine = c.discipline === 'MECHANICAL' ? 'MECHANICAL' : 'CIVIL';

  return (
    <div>
      <Letterhead
        title="Property Valuation Report"
        department={str(c.department)}
        reference={str(c.caseNumber)}
        dated={date(doc.signedAt)}
      />

      <Heading>Particulars</Heading>
      <Particulars
        rows={[
          ['Case number', str(c.caseNumber)],
          ['Request type', str(c.requestType)],
          ['Requesting unit', str(c.requestingUnit)],
          ['Property owner', str(c.owner)],
          ['Applicant', str(c.applicant)],
          ['Valuator', str(c.valuator)],
          ['Checker', str(c.checker)],
          ['Valuation date', date(v.valuationDate)],
        ]}
      />

      <Heading>Opinion of value</Heading>
      <Figures market={v.marketValue} forced={v.forcedSaleValue} currency={v.currency} />
      {str(v.remarks) ? (
        <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2 wrap-anywhere">
          {str(v.remarks)}
        </p>
      ) : null}

      <SiteInspection visits={arr(doc.siteInspection)} />

      <Heading>Working</Heading>
      <div className="text-[12px] [&_table]:min-w-0!">
        <WorkingTables engine={engine} output={calc.output} expanded />
      </div>

      <Heading>Approvals</Heading>
      <ul className="space-y-1 text-[12.5px]">
        {approvals.map((a, index) => (
          <li key={index} className="flex flex-wrap justify-between gap-2">
            <span>
              <span className="font-semibold">{role(a.level)}</span> - {str(a.approver)}
            </span>
            <span className="text-ink-3">
              {stamp(a.decidedAt)} · on {money(a.valueAtDecision, v.currency)}
            </span>
          </li>
        ))}
      </ul>

      <Heading>Signature</Heading>
      <Particulars
        rows={[
          ['Signed by', `${str(signer.name) ?? '—'} (${role(signer.role)})`],
          ['Signed on', stamp(doc.signedAt)],
          ['Status', signatureStatus],
          ['Parameter set', str(v.parameterSet)],
          [
            'Calculation',
            str(calc.inputHash) ? `fingerprint ${str(calc.inputHash)?.slice(0, 16)}…` : null,
          ],
        ]}
      />

      <DocumentFooter
        lines={[
          'Digitally signed. The signature covers every figure in this document; any change would invalidate it.',
        ]}
        fingerprint={fingerprint}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final letter (section 18)
// ---------------------------------------------------------------------------

export function FinalLetterDocument({
  doc,
  fingerprint,
}: {
  doc: Doc;
  fingerprint: string | null;
}) {
  // A letter is shown in the layout it was issued in: schema 1 predates the
  // Division's covering-letter formats and keeps its original wording.
  return doc.schemaVersion === 1 ? (
    <LegacyFinalLetter doc={doc} fingerprint={fingerprint} />
  ) : (
    <CoveringLetter doc={doc} fingerprint={fingerprint} />
  );
}

const LETTER_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "September 03, 2026" - the Division writes the day with two digits. */
function letterDate(value: unknown): string {
  const s = str(value);
  if (!s) return '—';
  const parsed = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(parsed.getTime()) ? s : LETTER_DATE.format(parsed);
}

const LETTER_FONT = { fontFamily: "'Times New Roman', Times, serif" };
const ETHIOPIC_FONT = { fontFamily: "Nyala, Ebrima, 'Noto Sans Ethiopic', sans-serif" };

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}

function sameParty(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function MemoLetterhead({ memorandum }: { memorandum: boolean }) {
  return (
    <header className="flex flex-col items-center">
      <div className="flex items-center gap-3">
        <Image src="/nib-logo.png" alt="" width={76} height={76} className="shrink-0" />
        <div className="leading-tight">
          <p lang="am" style={ETHIOPIC_FONT} className="text-[25px] font-bold text-nib-brown-600">
            ንብ ኢንተርናሽናል <span className="text-nib-gold-500">ባንክ</span>
          </p>
          <p className="font-sans text-[23px] font-extrabold tracking-tight text-nib-brown-600">
            Nib International<span className="text-nib-gold-500">Bank</span>
          </p>
        </div>
      </div>
      {memorandum ? (
        <p className="mt-1 font-sans text-[15px]">Inter Department Memorandum</p>
      ) : null}
    </header>
  );
}

/** The Date / From / To / Subject / CC / Att. block between double rules. */
function MemoParticulars({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="mt-8 border-y-[3px] border-black py-[2px]">
      <table className="w-full border-collapse border-y border-black text-[15px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-black last:border-b-0">
              <th
                scope="row"
                className="w-[17%] border-r border-black px-2 py-1.5 text-right align-middle font-normal"
              >
                {label}
              </th>
              <td className="px-2 py-1.5 align-middle">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The covering letter in the Division's three formats (letter-format.ts):
 * completed, under construction, and loan recovery. The wording follows the
 * Division's sample letters; every name, place and figure comes from the
 * snapshot.
 */
function CoveringLetter({ doc, fingerprint }: { doc: Doc; fingerprint: string | null }) {
  const c = obj(doc.case);
  const v = obj(doc.valuation);
  const letter = obj(doc.letter);
  const issuer = obj(doc.issuer);
  const signed = obj(doc.signedReport);
  const value = obj(letter.statedValue);

  const format = str(letter.format) ?? 'COMPLETED';
  const recovery = format === 'LOAN_RECOVERY';
  const applicant = str(c.applicant);
  const owner = str(c.owner);
  const location = str(letter.location);
  const identifier = str(letter.identifier);
  const noun = obj(doc.property).kind === 'MECHANICAL' ? 'property' : 'building';
  const unit = (str(v.currency) ?? 'ETB') === 'ETB' ? 'Birr' : (str(v.currency) ?? '');
  const amount = str(value.amount);

  let body: React.ReactNode;
  if (recovery) {
    const place =
      location && identifier ? (
        <>
          {' '}
          located at <B>{location},</B> identified by LHC Number <B>{identifier}.</B>
        </>
      ) : location ? (
        <>
          {' '}
          located at <B>{location}.</B>
        </>
      ) : identifier ? (
        <>
          {' '}
          identified by LHC Number <B>{identifier}.</B>
        </>
      ) : (
        '.'
      );
    body = (
      <p>
        In response to your request submitted to our department on {letterDate(letter.requestedOn)}{' '}
        G.C. for the estimation of {noun},{' '}
        {sameParty(applicant, owner) ? (
          <>
            the applicant &amp; owner is <B>{owner},</B>
          </>
        ) : (
          <>
            the applicant is <B>{applicant}</B> and the owner is <B>{owner},</B>
          </>
        )}{' '}
        we have completed the valuation of the {noun}
        {place}
        {amount ? (
          <>
            {' '}
            The estimated Foreclosure value is{' '}
            <B>
              {formatAmount(amount)} ({str(value.words)} &amp; {str(value.cents)}/100).
            </B>
          </>
        ) : null}
      </p>
    );
  } else {
    body = (
      <p>
        In response to your request submitted to our department on {letterDate(letter.requestedOn)}{' '}
        G.C for the estimation of the{' '}
        {format === 'UNDER_CONSTRUCTION' ? 'under construction building' : noun} for the applicant{' '}
        {sameParty(applicant, owner) ? (
          <>
            and Property owner <B>{owner}</B>
          </>
        ) : (
          <>
            <B>{applicant}</B> and Property owner of <B>{owner}</B>
          </>
        )}
        {location ? (
          <>
            {' '}
            located in <B>{location}</B>
          </>
        ) : null}
        {identifier ? (
          <>
            {' '}
            and identified by <B>{identifier}</B>
          </>
        ) : null}
        .
        {format === 'COMPLETED' && amount ? (
          <>
            {' '}
            The estimation value is <B>{formatAmount(amount)}</B> ({str(value.words)} {unit} and{' '}
            {str(value.cents)}/100) {unit}.
          </>
        ) : null}
      </p>
    );
  }

  return (
    <div style={LETTER_FONT} className="text-black">
      <MemoLetterhead memorandum={recovery} />

      <MemoParticulars
        rows={[
          ['Date', `${letterDate(doc.date)} G.C`],
          [
            'From',
            <>
              {str(issuer.name)}
              <br />
              {str(issuer.title) ?? role(issuer.role)}
            </>,
          ],
          ['To', str(doc.addressee)],
          ['Subject', 'Property Estimation Result'],
          ['CC', ' '],
          ['Att.', 'Original Estimation'],
        ]}
      />

      <div className="mt-8 space-y-5 text-justify text-[16px] leading-[2]">
        {body}
        <p>
          {recovery
            ? 'Please find the attached original estimation results along with the remarks.'
            : 'Please find the attached original estimation result along with the remark.'}
        </p>
      </div>

      <p className={cn('mt-12 text-[16px]', !recovery && 'font-bold')}>
        {recovery ? 'Best regards,' : 'Best regards'}
      </p>
      <div className="h-24" aria-hidden="true" />

      <DocumentFooter
        lines={[
          `Ref. ${str(doc.reference) ?? '—'} · Issued under: ${str(doc.authority) ?? '—'}`,
          str(signed.sha256)
            ? `Signed report fingerprint ${str(signed.sha256)?.slice(0, 16)}…`
            : '',
        ].filter(Boolean)}
        fingerprint={fingerprint}
      />
    </div>
  );
}

function LegacyFinalLetter({ doc, fingerprint }: { doc: Doc; fingerprint: string | null }) {
  const c = obj(doc.case);
  const v = obj(doc.valuation);
  const issuer = obj(doc.issuer);
  const signed = obj(doc.signedReport);
  const property = obj(doc.property);
  const location = str(property.location);

  return (
    <div className="text-[13.5px] leading-relaxed text-ink">
      <Letterhead
        title="Final Valuation Letter"
        department={str(doc.department)}
        reference={str(doc.reference)}
        dated={date(doc.date)}
      />

      <div className="mt-8 space-y-5">
        <p>
          To: <span className="font-semibold">{str(doc.addressee)}</span>
        </p>
        <p className="font-semibold">
          Subject: Valuation of property owned by {str(c.owner)} - case {str(c.caseNumber)}
        </p>
        <p>
          Further to your {str(c.requestType)?.toLowerCase() ?? ''} valuation request on behalf of{' '}
          {str(c.applicant)}, the Property Valuation Department has completed the valuation of the
          property owned by {str(c.owner)}
          {location ? `, located at ${location}` : ''}, as at {date(v.valuationDate)}.
        </p>
        <p>
          The estimated market value of the property is{' '}
          <span className="font-bold">{money(v.marketValue, v.currency)}</span>, and its forced-sale
          value is <span className="font-bold">{money(v.forcedSaleValue, v.currency)}</span>.
        </p>
        <p>
          This letter summarises the signed valuation report
          {signed.version !== undefined ? ` (version ${String(signed.version)})` : ''}, which sets
          out the full basis of the valuation and is available to you in the valuation system.
        </p>
        <div className="pt-6">
          <p>Yours faithfully,</p>
          <div className="mt-10 w-64 border-t border-ink-3 pt-1">
            <p className="font-semibold">{str(issuer.name)}</p>
            <p className="text-ink-2">{role(issuer.role)}</p>
            <p className="text-ink-2">{str(doc.department)}</p>
          </div>
        </div>
      </div>

      <DocumentFooter
        lines={[
          `Issued under: ${str(doc.authority) ?? '—'}`,
          str(signed.sha256)
            ? `Signed report fingerprint ${str(signed.sha256)?.slice(0, 16)}…`
            : '',
        ].filter(Boolean)}
        fingerprint={fingerprint}
      />
    </div>
  );
}

function DocumentFooter({ lines, fingerprint }: { lines: string[]; fingerprint: string | null }) {
  return (
    <footer className="mt-10 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink-3">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {fingerprint ? (
        <p className="font-mono">Document fingerprint (SHA-256) {fingerprint}</p>
      ) : null}
    </footer>
  );
}
