import path from 'node:path';
import type { OutboundMessage } from '@/server/domain/ports/messaging';

/**
 * The bank's account email: logo, heading, a few lines and one button - the
 * same card the KYC portal sends, so staff see one design from every NIB
 * system.
 *
 * Tables and inline styles because that is what email clients render; the logo
 * travels inside the message (`cid:`) so it shows even when the application
 * is only reachable on the bank's network.
 */

const LOGO_CID = 'nib-logo';

export interface BrandedEmail {
  to: string;
  subject: string;
  heading: string;
  greeting: string;
  /** Plain sentences. Escaped here; mark a phrase bold with `strong`. */
  paragraphs: readonly string[];
  /** Words in the paragraphs or validity line to show in bold. */
  strong?: readonly string[];
  validity?: string;
  action: { label: string; url: string };
  note: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a sentence, then bold the phrases asked for. */
function richText(sentence: string, strong: readonly string[]): string {
  let html = escapeHtml(sentence);
  for (const phrase of strong) {
    const escaped = escapeHtml(phrase);
    html = html.split(escaped).join(`<strong>${escaped}</strong>`);
  }
  return html;
}

export function brandedEmail(email: BrandedEmail): OutboundMessage {
  const strong = email.strong ?? [];
  const paragraph = (text: string, bottom = 14) =>
    `<p style="margin:0 0 ${bottom}px;color:#374151;font-size:15px;line-height:1.75;">${richText(text, strong)}</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f0eb;font-family:Helvetica Neue,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0eb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="background:#ffffff;border-radius:12px;padding:40px 40px 32px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <img src="cid:${LOGO_CID}" alt="NIB International Bank" width="64" height="64" style="display:block;border:0;"/>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:24px;">
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${escapeHtml(email.heading)}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:12px;">
                    <p style="margin:0;color:#374151;font-size:15px;line-height:1.75;">${escapeHtml(email.greeting)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:4px;">
                    ${email.paragraphs.map((text) => paragraph(text)).join('\n                    ')}
                    ${email.validity ? paragraph(email.validity, 24) : ''}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <a href="${escapeHtml(email.action.url)}" style="display:inline-block;background:#8B5E2E;color:#ffffff;font-size:16px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.01em;">${escapeHtml(email.action.label)} &rarr;</a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <p style="margin:0;color:#6B7280;font-size:13px;line-height:1.6;">${escapeHtml(email.note)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0 0;">
              <p style="margin:0;color:#9CA3AF;font-size:12px;">This is an automated message. Please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    email.heading,
    '',
    email.greeting,
    '',
    ...email.paragraphs,
    ...(email.validity ? ['', email.validity] : []),
    '',
    `${email.action.label}: ${email.action.url}`,
    '',
    email.note,
    '',
    'This is an automated message. Please do not reply.',
  ].join('\n');

  return {
    to: email.to,
    subject: email.subject,
    text,
    html,
    inlineImages: [{ cid: LOGO_CID, path: path.join(process.cwd(), 'public', 'nib-logo.png') }],
  };
}
