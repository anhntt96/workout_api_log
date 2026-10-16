/** Any UUID-shaped id (8-4-4-4-12 hex), the same rule the API applies to `userId`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/** `0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e` → `0b7e5f0e…5d6e`, for compact display. */
export function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
