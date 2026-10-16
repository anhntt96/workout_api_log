import { isCalendarDate, latestAllowedWorkoutDate, parseWorkoutDate } from './workout-date.js';

describe('parseWorkoutDate', () => {
  it.each([
    ['2026-10-14', '2026-10-14'],
    ['2026-10-14T06:00:00+07:00', '2026-10-14'], // Hanoi morning stays on the 14th (UTC is the 13th)
    ['2026-10-13T23:00:00Z', '2026-10-13'], // Z means the client chose UTC
    ['2026-10-14T23:30:00-05:00', '2026-10-14'], // New York evening stays on the 14th (UTC is the 15th)
    ['2026-10-14T06:00+07:00', '2026-10-14'], // seconds are optional
    ['2026-10-14T06:00:00.123456+14:00', '2026-10-14'],
    ['2024-02-29', '2024-02-29'],
  ])('reads %s as %s', (input, expected) => {
    expect(parseWorkoutDate(input)).toEqual({ ok: true, date: expected });
  });

  it('rejects a datetime without an offset as ambiguous', () => {
    expect(parseWorkoutDate('2026-10-14T06:00:00')).toEqual({
      ok: false,
      message:
        'datetime must include a UTC offset, e.g. 2026-10-14T06:00:00+07:00, or be a plain date (YYYY-MM-DD)',
    });
  });

  it('names an impossible calendar date', () => {
    expect(parseWorkoutDate('2026-02-30')).toEqual({
      ok: false,
      message: '"2026-02-30" is not a valid calendar date',
    });
  });

  it.each([
    '2025-02-29',
    '2026-13-01',
    '2026-10-14T24:00:00Z',
    '2026-10-14T06:60:00Z',
    '2026-10-14T06:00:00+15:00',
    '2026-02-30T06:00:00Z',
  ])('rejects impossible value %s', (input) => {
    expect(parseWorkoutDate(input).ok).toBe(false);
  });

  it.each([
    '14/10/2026',
    '2026-1-4',
    '',
    'yesterday',
    '2026-10-14 06:00:00+07:00',
    '2026-10-14T06:00:00+0700',
  ])('rejects unsupported format %j', (input) => {
    expect(parseWorkoutDate(input)).toEqual({
      ok: false,
      message: 'date must be YYYY-MM-DD or an ISO 8601 datetime with an offset',
    });
  });
});

describe('isCalendarDate', () => {
  it('accepts only a real YYYY-MM-DD day', () => {
    expect(isCalendarDate('2026-10-14')).toBe(true);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-10-14T00:00:00Z')).toBe(false);
  });
});

describe('latestAllowedWorkoutDate', () => {
  it('is the day after the current UTC date', () => {
    expect(latestAllowedWorkoutDate(new Date('2026-10-15T12:00:00Z'))).toBe('2026-10-16');
  });

  it('uses the UTC date, not the server time zone', () => {
    // 2026-10-15T23:59:59-05:00 is 2026-10-16T04:59:59Z.
    expect(latestAllowedWorkoutDate(new Date('2026-10-15T23:59:59-05:00'))).toBe('2026-10-17');
  });

  it('rolls over month and year ends', () => {
    expect(latestAllowedWorkoutDate(new Date('2026-12-31T08:00:00Z'))).toBe('2027-01-01');
  });
});
