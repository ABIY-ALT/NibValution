import pino from 'pino';

/**
 * Structured logging with a correlation id.
 *
 * Every request carries a correlation id that is propagated into service calls
 * and written to `AuditLog.correlationId`, so an auditor investigating "what
 * happened when case PV-2026-000042 was approved" can reconstruct the whole
 * chain - HTTP request, workflow transition, notification, PDF job - from one
 * identifier.
 */

const redactPaths = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'tokenHash',
  'sessionToken',
  'mfaSecret',
  'signature',
  'privateKey',
  'req.headers.cookie',
  'req.headers.authorization',
  '*.password',
  '*.passwordHash',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'nib-valuation' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** A child logger bound to one request or job. */
export function loggerFor(correlationId: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ correlationId, ...extra });
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}
