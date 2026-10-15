/** Escapes LIKE wildcards so user input matches literally (`%` and `_` are not wildcards). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
