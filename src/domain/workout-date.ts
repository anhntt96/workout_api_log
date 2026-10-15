const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;
const DATETIME_WITHOUT_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;

export type WorkoutDateResult = { ok: true; date: string } | { ok: false; message: string };

/** True for a real calendar day in YYYY-MM-DD form (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = PLAIN_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Reads the workout day from a `date` input (ADR 0002):
 * - `YYYY-MM-DD` is used as is.
 * - An ISO 8601 datetime with an offset (`Z` or `±HH:MM`) gives the calendar day in that
 *   offset, which is the string's date part. It is never converted to UTC first.
 * - A datetime without an offset is ambiguous and rejected.
 */
export function parseWorkoutDate(input: string): WorkoutDateResult {
  if (PLAIN_DATE.test(input)) {
    return isCalendarDate(input) ? { ok: true, date: input } : invalid(`"${input}" is not a valid calendar date`);
  }
  const match = DATETIME_WITH_OFFSET.exec(input);
  if (match) {
    const [, day, hours, minutes, seconds = '00', , offsetHours = '00', offsetMinutes = '00'] = match;
    const validTime = Number(hours) <= 23 && Number(minutes) <= 59 && Number(seconds) <= 59;
    const validOffset = Number(offsetHours) <= 14 && Number(offsetMinutes) <= 59;
    if (isCalendarDate(day) && validTime && validOffset) return { ok: true, date: day };
    return invalid(`"${input}" is not a valid ISO 8601 datetime`);
  }
  if (DATETIME_WITHOUT_OFFSET.test(input)) {
    return invalid(
      'datetime must include a UTC offset, e.g. 2026-10-14T06:00:00+07:00, or be a plain date (YYYY-MM-DD)',
    );
  }
  return invalid('date must be YYYY-MM-DD or an ISO 8601 datetime with an offset');
}

/**
 * The latest accepted workout day: one day after the current UTC date. The slack lets
 * clients in time zones ahead of UTC log their "today" (ADR 0002).
 */
export function latestAllowedWorkoutDate(now: Date): string {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString().slice(0, 10);
}

function invalid(message: string): WorkoutDateResult {
  return { ok: false, message };
}
