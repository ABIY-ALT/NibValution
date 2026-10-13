import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MessageSender, OutboundMessage } from '@/server/domain/ports/messaging';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly user?: string;
  readonly password?: string;
  readonly from: string;
  readonly allowSelfSigned: boolean;
}

/**
 * Email through the bank's SMTP relay.
 *
 * Port 465 speaks TLS from the first byte; any other port starts in plain text
 * and upgrades with STARTTLS. When credentials are configured the upgrade is
 * required, so a relay that stops offering STARTTLS fails the send instead of
 * receiving the password in the clear.
 */
export class SmtpSender implements MessageSender {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    const secure = options.port === 465;
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure,
      requireTLS: !secure && Boolean(options.user),
      auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
      tls: options.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
      // Notifications are sent inside a workflow action; an unresponsive relay
      // must fail the delivery, not hold the action open.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.inlineImages?.map((image) => ({
        filename: path.basename(image.path),
        path: image.path,
        cid: image.cid,
      })),
    });
  }

  /** Connect and log in without sending anything. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
}
