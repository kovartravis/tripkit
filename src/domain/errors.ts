/**
 * Errors the ledger raises on purpose. The MCP layer maps these to
 * `isError` tool results with the message verbatim, so keep messages
 * actionable for an agent ("what do I change to make this succeed").
 */
export class TripkitError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'TripkitError';
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends TripkitError {
  constructor(kind: string, id: string) {
    super('not_found', `${kind} "${id}" not found`, { kind, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends TripkitError {
  constructor(message: string, details?: unknown) {
    super('validation', message, details);
    this.name = 'ValidationError';
  }
}

export class PlanConflictError extends TripkitError {
  constructor(message: string, details?: unknown) {
    super('plan_conflict', message, details);
    this.name = 'PlanConflictError';
  }
}
