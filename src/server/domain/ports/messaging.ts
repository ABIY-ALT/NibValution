/**
 * Outbound messages - email and SMS (spec section 23; assumption 7.4).
 *
 * Notification dispatch sends through this port and never talks to a mail
 * server or SMS gateway itself, so the bank's SMTP relay or SMS provider plugs
 * in without touching the workflow.
 */

export interface OutboundMessage {
  /** An email address or a phone number, depending on the channel. */
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** An HTML alternative to `text`, for email. Clients that cannot show it fall back to the text. */
  readonly html?: string;
  /**
   * Images the HTML shows as `<img src="cid:...">`. Carried inside the message
   * rather than linked, so they appear without the recipient's client having
   * to reach the application's server.
   */
  readonly inlineImages?: readonly { readonly cid: string; readonly path: string }[];
}

export interface MessageSender {
  /** Stored with the delivery record, e.g. `log` or `smtp`. */
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
}
