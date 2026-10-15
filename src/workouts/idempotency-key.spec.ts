import { RequestValidationError } from '../common/errors/request-validation.error.js';
import { entryIdempotencyKey, parseIdempotencyKey } from './idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it('allows the header to be absent', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('accepts visible ASCII keys, including #', () => {
    expect(parseIdempotencyKey('a1b2-c3#d4')).toBe('a1b2-c3#d4');
  });

  it.each(['', 'has space', 'x'.repeat(201), 'naïve'])('rejects %j', (raw) => {
    expect(() => parseIdempotencyKey(raw)).toThrow(RequestValidationError);
  });
});

describe('entryIdempotencyKey', () => {
  it("appends the entry's position in the request", () => {
    expect(entryIdempotencyKey('K', 0)).toBe('K#0');
    expect(entryIdempotencyKey('a#1', 10)).toBe('a#1#10');
  });
});
