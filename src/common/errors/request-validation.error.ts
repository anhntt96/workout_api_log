export interface FieldError {
  /** Path of the offending input, e.g. `entries[2].exerciseName`. */
  field: string;
  message: string;
}

/** A 400 for one or more invalid inputs; the exception filter renders it in the standard error format. */
export class RequestValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}
