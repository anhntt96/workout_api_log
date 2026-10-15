/** Formats a validation path like ['entries', 2, 'sets', 0, 'weight'] as `entries[2].sets[0].weight`. */
export function formatFieldPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    const key = String(segment);
    return formatted === '' ? key : `${formatted}.${key}`;
  }, '');
}
