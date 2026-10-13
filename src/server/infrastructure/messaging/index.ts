import type { MessageSender, OutboundMessage } from '@/server/domain/ports/messaging';
import { serverEnv } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { SmtpSender } from './smtp-sender';

/**
 * Message senders.
 *
 * `log` writes the message to the server log instead of sending it - the
 * development default, refused in production by the environment check. `smtp`
 * sends through the bank's relay. The HTTP-SMS adapter is the slot for the SMS
 * gateway (open question 7.4): until it is connected - like SMTP with no host
 * set - it fails, so a message is recorded as undelivered rather than silently
 * dropped.
 */

class LogSender implements MessageSender {
  constructor(
    readonly name: string,
    private readonly channel: 'email' | 'sms',
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    logger.info(
      { channel: this.channel, to: message.to, subject: message.subject },
      `Outbound ${this.channel} (log driver - not sent)`,
    );
  }
}

class NotConnectedSender implements MessageSender {
  constructor(
    readonly name: string,
    private readonly what: string,
  ) {}

  async send(): Promise<void> {
    throw new ConfigurationError(`${this.what} is not connected yet.`);
  }
}

let mailer: MessageSender | null = null;
let sms: MessageSender | null = null;

export function getMailer(): MessageSender {
  mailer ??=
    serverEnv.MAIL_DRIVER === 'smtp'
      ? (smtpSenderFromEnv() ?? new NotConnectedSender('smtp', 'The SMTP relay (no host set)'))
      : new LogSender('log', 'email');
  return mailer;
}

/** The SMTP sender the configuration describes, or `null` when no relay host is set. */
export function smtpSenderFromEnv(): SmtpSender | null {
  if (!serverEnv.SMTP_HOST) return null;
  return new SmtpSender({
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    user: serverEnv.SMTP_USER,
    password: serverEnv.SMTP_PASSWORD,
    from: serverEnv.MAIL_FROM,
    allowSelfSigned: serverEnv.SMTP_ALLOW_SELF_SIGNED,
  });
}

export function getSmsSender(): MessageSender {
  sms ??=
    serverEnv.SMS_DRIVER === 'http'
      ? new NotConnectedSender('http', 'The SMS gateway')
      : new LogSender('log', 'sms');
  return sms;
}

/** Tests substitute senders; `null` restores the configured ones. */
export function __setMessageSenders(replacement: {
  mail?: MessageSender | null;
  sms?: MessageSender | null;
}): void {
  if ('mail' in replacement) mailer = replacement.mail ?? null;
  if ('sms' in replacement) sms = replacement.sms ?? null;
}
