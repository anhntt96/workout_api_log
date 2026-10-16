import {
  addDays,
  comparisonPeriods,
  formatDate,
  formatDayHeading,
  formatDayRange,
  parseIsoDay,
  todayIsoDay,
} from './dates';

// Vitest runs in Asia/Ho_Chi_Minh (UTC+7, see vite.config.ts), so a UTC-based implementation fails here.
describe('todayIsoDay', () => {
  it('reads the local calendar day just after midnight', () => {
    expect(todayIsoDay(new Date(2026, 9, 16, 0, 30))).toBe('2026-10-16');
  });

  it('reads the local calendar day just before midnight', () => {
    expect(todayIsoDay(new Date(2026, 9, 16, 23, 30))).toBe('2026-10-16');
  });
});

describe('parseIsoDay', () => {
  it('returns local midnight of that day', () => {
    const date = parseIsoDay('2026-10-14');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 14, 0]);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('formatDayHeading', () => {
  const today = '2026-10-16';

  it('names today and yesterday', () => {
    expect(formatDayHeading('2026-10-16', today)).toBe('Today');
    expect(formatDayHeading('2026-10-15', today)).toBe('Yesterday');
  });

  it('omits the year for days in the current year', () => {
    expect(formatDayHeading('2026-10-14', today)).toBe('Wed, Oct 14');
  });

  it('includes the year for other years', () => {
    expect(formatDayHeading('2025-12-29', today)).toBe('Mon, Dec 29, 2025');
  });
});

describe('formatDate and formatDayRange', () => {
  it('formats a day', () => {
    expect(formatDate('2026-09-02')).toBe('Sep 2, 2026');
  });

  it('shows the year once for a range within one year', () => {
    expect(formatDayRange('2026-09-01', '2026-09-30')).toBe('Sep 1 – Sep 30, 2026');
  });

  it('shows both years for a range across years', () => {
    expect(formatDayRange('2025-12-29', '2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});

describe('comparisonPeriods', () => {
  it('compares this month so far with all of last month', () => {
    expect(comparisonPeriods('month', '2026-10-16')).toEqual({
      current: { from: '2026-10-01', to: '2026-10-16' },
      baseline: { from: '2026-09-01', to: '2026-09-30' },
      currentLabel: 'This month',
      baselineLabel: 'Last month',
    });
  });

  it('reaches back into the previous year in January and handles leap years', () => {
    expect(comparisonPeriods('month', '2026-01-10').baseline).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(comparisonPeriods('month', '2028-03-05').baseline).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('starts weeks on Monday', () => {
    // 2026-10-16 is a Friday; 2026-10-18 is a Sunday.
    expect(comparisonPeriods('week', '2026-10-16')).toMatchObject({
      current: { from: '2026-10-12', to: '2026-10-16' },
      baseline: { from: '2026-10-05', to: '2026-10-11' },
    });
    expect(comparisonPeriods('week', '2026-10-18').current).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(comparisonPeriods('week', '2026-10-12').current).toEqual({ from: '2026-10-12', to: '2026-10-12' });
  });

  it('compares this year so far with all of last year', () => {
    expect(comparisonPeriods('year', '2026-10-16')).toMatchObject({
      current: { from: '2026-01-01', to: '2026-10-16' },
      baseline: { from: '2025-01-01', to: '2025-12-31' },
    });
  });
});
