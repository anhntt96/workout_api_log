import type { FieldError } from '../api/types';

/** API field errors by path (`entries[0].sets[1].weight`), keeping the first message for each field. */
export function fieldErrorMap(errors: readonly FieldError[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const error of errors) {
    if (!map.has(error.field)) map.set(error.field, error.message);
  }
  return map;
}
