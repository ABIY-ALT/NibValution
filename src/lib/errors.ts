/**
 * Application error taxonomy.
 *
 * Each error carries the HTTP status it maps to and a stable machine-readable
 * code, so route handlers and server actions translate failures uniformly and
 * no call site has to invent its own status mapping.
 */

export type ProblemDetail = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: Record<string, string[]>;
  correlationId?: string;
};

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly safeDetail: string | undefined;

  constructor(message: string, safeDetail?: string) {
    super(message);
    this.name = new.target.name;
    this.safeDetail = safeDetail;
  }

  toProblem(correlationId?: string): ProblemDetail {
    return {
      type: `https://nib.example/problems/${this.code.toLowerCase()}`,
      title: this.code,
      status: this.status,
      code: this.code,
      detail: this.safeDetail ?? this.message,
      correlationId,
    };
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'VALIDATION_FAILED';
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }

  override toProblem(correlationId?: string): ProblemDetail {
    return { ...super.toProblem(correlationId), errors: this.fieldErrors };
  }
}

export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code = 'UNAUTHENTICATED';
  constructor(message = 'Authentication is required.') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'FORBIDDEN';
  constructor(message = 'You are not permitted to perform this action.') {
    super(message);
  }
}

/**
 * Also used deliberately when a record exists but lies outside the caller's
 * scope. Returning 403 there would confirm the record's existence and turn an
 * access check into an enumeration oracle (spec section 26, IDOR).
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'The requested resource was not found.') {
    super(message);
  }
}

/** Optimistic-lock or state conflict (rules 12-14). */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'CONFLICT';
  readonly currentVersion: number | undefined;
  readonly currentStatus: string | undefined;

  constructor(message: string, currentVersion?: number, currentStatus?: string) {
    super(message);
    this.currentVersion = currentVersion;
    this.currentStatus = currentStatus;
  }
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  readonly code = 'PAYLOAD_TOO_LARGE';
}

/** A syntactically valid request that a business rule refuses. */
export class BusinessRuleError extends AppError {
  readonly status = 422;
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly rule: string;

  constructor(rule: string, message: string) {
    super(message);
    this.rule = rule;
  }

  override toProblem(correlationId?: string): ProblemDetail {
    return { ...super.toProblem(correlationId), title: this.rule };
  }
}

/** An illegal workflow transition (spec section 20 - status is never set freely). */
export class WorkflowError extends BusinessRuleError {
  constructor(message: string) {
    super('ILLEGAL_TRANSITION', message);
  }
}

export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = 'RATE_LIMITED';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many attempts. Please try again later.') {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ConfigurationError extends AppError {
  readonly status = 500;
  readonly code = 'CONFIGURATION_ERROR';
  constructor(message: string) {
    // The caller sees a generic message; the specific misconfiguration stays
    // in the server log rather than being handed to a potential attacker.
    super(message, 'The system is not correctly configured. Please contact an administrator.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An id taken from a URL, checked before it reaches the database. A malformed
 * one is "not found" - the same answer as any other id the caller cannot open
 * - rather than a database error and a 500.
 */
export function assertUuid(value: string, message?: string): void {
  if (!UUID.test(value)) throw new NotFoundError(message);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
