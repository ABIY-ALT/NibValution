/**
 * Check the SMTP relay: connect and log in, then send one test message.
 *
 *   npx tsx scripts/ops/mail-check.mts [recipient]
 *
 * The recipient defaults to the sending mailbox itself (SMTP_USER), so the
 * check writes to nobody else unless asked to.
 */
process.loadEnvFile('.env');

const { serverEnv } = await import('../../src/lib/env.ts');
const { smtpSenderFromEnv } = await import('../../src/server/infrastructure/messaging/index.ts');

const sender = smtpSenderFromEnv();
if (!sender) {
  console.error('No relay configured: set SMTP_HOST (or EMAIL_HOST) in .env.');
  process.exit(1);
}

const recipient = process.argv[2] ?? serverEnv.SMTP_USER;
if (!recipient) {
  console.error('No recipient: pass one, e.g. npx tsx scripts/ops/mail-check.mts you@nibbank.com.et');
  process.exit(1);
}

console.log(`Relay      ${serverEnv.SMTP_HOST}:${serverEnv.SMTP_PORT}`);
console.log(`Login      ${serverEnv.SMTP_USER ?? '(none)'}`);
console.log(`From       ${serverEnv.MAIL_FROM}`);
console.log(`Self-signed certificate accepted: ${serverEnv.SMTP_ALLOW_SELF_SIGNED ? 'yes' : 'no'}`);
console.log(`MAIL_DRIVER=${serverEnv.MAIL_DRIVER}${serverEnv.MAIL_DRIVER === 'smtp' ? '' : ' (the app is NOT sending email; set MAIL_DRIVER=smtp)'}`);

try {
  await sender.verify();
  console.log('Connect and login: OK');

  await sender.send({
    to: recipient,
    subject: '[NIB Valuation] SMTP check',
    text: `This is a test message from the NIB Property Valuation system (${serverEnv.APP_URL}), sent ${new Date().toISOString()}.`,
  });
  console.log(`Test message accepted by the relay for ${recipient}`);
} catch (error) {
  console.error('SMTP check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
