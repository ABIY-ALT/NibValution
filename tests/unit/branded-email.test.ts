import { describe, expect, it } from 'vitest';
import { brandedEmail } from '@/server/infrastructure/messaging/branded-email';

/**
 * The account email. A user's name is typed by an administrator and lands in
 * HTML, so it must arrive as text; and the logo must travel inside the message,
 * since the application may not be reachable from the recipient's mail client.
 */

const email = () =>
  brandedEmail({
    to: 'abebe@nibbank.com.et',
    subject: 'Your NIB Property Valuation Password Reset Request',
    heading: 'Your Password Reset Request',
    greeting: 'Hello Abebe <script>alert(1)</script>,',
    paragraphs: ['You can reset your password by clicking the link below.'],
    strong: ['24 hours'],
    validity: 'This link is valid for 24 hours and can only be used once.',
    action: { label: 'Reset Your Password', url: 'http://localhost:3008/set-password?token=a&b' },
    note: 'If you did not expect this reset, you can safely ignore this email.',
  });

describe('branded account email', () => {
  it('escapes what an administrator typed', () => {
    const { html } = email();
    expect(html).not.toContain('<script>');
    expect(html).toContain('Hello Abebe &lt;script&gt;alert(1)&lt;/script&gt;,');
    expect(html).toContain('href="http://localhost:3008/set-password?token=a&amp;b"');
  });

  it('bolds only the phrases asked for', () => {
    expect(email().html).toContain('This link is valid for <strong>24 hours</strong>');
  });

  it('carries the logo inside the message', () => {
    const message = email();
    expect(message.html).toContain('src="cid:nib-logo"');
    expect(message.inlineImages).toEqual([
      expect.objectContaining({ cid: 'nib-logo', path: expect.stringMatching(/nib-logo\.png$/) }),
    ]);
  });

  it('has a plain-text alternative with the link spelled out', () => {
    const { text } = email();
    expect(text).toContain('Reset Your Password: http://localhost:3008/set-password?token=a&b');
    expect(text).not.toContain('<strong>');
  });
});
