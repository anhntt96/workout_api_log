import { z } from 'zod';

/** Position after the last entry of a page, in history order (performed_on, created_at, id). */
export interface HistoryCursor {
  performedOn: string;
  createdAt: string;
  id: string;
}

const notBeforeYearOne = (value: string): boolean => value >= '0001-01-01';
const cursorTuple = z.tuple([
  z.iso.date().refine(notBeforeYearOne),
  z.iso.datetime().refine(notBeforeYearOne),
  z.guid(),
]);

/** Opaque, URL-safe cursor: base64url of a JSON tuple. */
export function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify([cursor.performedOn, cursor.createdAt, cursor.id])).toString('base64url');
}

/** Returns null for anything that is not a cursor produced by `encodeCursor`. */
export function decodeCursor(raw: string): HistoryCursor | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = cursorTuple.safeParse(decoded);
  if (!parsed.success) return null;
  const [performedOn, createdAt, id] = parsed.data;
  return { performedOn, createdAt, id };
}
