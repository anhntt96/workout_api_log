import { RequestValidationError } from '../common/errors/request-validation.error.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

const VALID_KEY = /^[\x21-\x7e]{1,200}$/;

/** Validates the optional Idempotency-Key header: 1–200 visible ASCII characters. */
export function parseIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (VALID_KEY.test(raw)) return raw;
  throw new RequestValidationError([
    {
      field: IDEMPOTENCY_KEY_HEADER,
      message: 'Idempotency-Key must be 1-200 visible ASCII characters without spaces',
    },
  ]);
}

/**
 * Per-entry key stored in `workout_entries.idempotency_key` (ADR 0003): the request key plus
 * the entry's position, `K#0`, `K#1`, … The index after the last `#` keeps keys from different
 * requests distinct even when a client's key contains `#`.
 */
export function entryIdempotencyKey(requestKey: string, index: number): string {
  return `${requestKey}#${index}`;
}
