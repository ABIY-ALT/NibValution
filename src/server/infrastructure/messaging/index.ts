import type { MessageSender, OutboundMessage } from '@/server/domain/ports/messaging';
import { serverEnv } from '@/lib/env';
import { ConfigurationError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Message senders.
 *
 * `log` writes the message to the server log instead of sending it - the
 * development default, refused in production by the environment check. The
 * SMTP and HTTP-SMS adapters are the slots for the bank's relay and gateway
 * (open questions 7.4 and the mail server): until they are connected they fail,
 * so a message is recorded as undelivered rather than silently dropped.
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
      ? new NotConnectedSender('smtp', `The SMTP relay (${serverEnv.SMTP_HOST ?? 'no host set'})`)
      : new LogSender('log', 'email');
  return mailer;
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
