// Calendar days are `YYYY-MM-DD` strings in the browser's time zone. The client owns "today" and
// every period boundary (ADR 0002); never derive a day from `toISOString()`, which is the UTC day.

export interface DayRange {
  from: string;
  to: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIsoDay(now: Date = new Date()): string {
  return toIsoDay(now);
}

/** Local midnight of `day`. `new Date('2026-10-14')` would be UTC midnight, the previous day west of UTC. */
export function parseIsoDay(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

export function addDays(day: string, amount: number): string {
  const date = parseIsoDay(day);
  date.setDate(date.getDate() + amount);
  return toIsoDay(date);
}

const weekdayMonthDay = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const weekdayMonthDayYear = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** History group heading: "Today", "Yesterday", "Wed, Oct 14", or "Mon, Dec 29, 2025" in another year. */
export function formatDayHeading(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const format = day.slice(0, 4) === today.slice(0, 4) ? weekdayMonthDay : weekdayMonthDayYear;
  return format.format(parseIsoDay(day));
}

/** "Sep 2, 2026" */
export function formatDate(day: string): string {
  return monthDayYear.format(parseIsoDay(day));
}

/** "Sep 1 – Sep 30, 2026", or "Dec 29, 2025 – Jan 4, 2026" across years. */
export function formatDayRange(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${monthDay.format(parseIsoDay(from))} – ${formatDate(to)}`;
  }
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export type PeriodPreset = 'week' | 'month' | 'year';

export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export interface PeriodComparison {
  current: DayRange;
  baseline: DayRange;
  currentLabel: string;
  baselineLabel: string;
}

/** The current period up to today against the whole previous period. Weeks start on Monday. */
export function comparisonPeriods(preset: PeriodPreset, today: string): PeriodComparison {
  const date = parseIsoDay(today);
  switch (preset) {
    case 'week': {
      const daysSinceMonday = (date.getDay() + 6) % 7;
      const monday = addDays(today, -daysSinceMonday);
      return {
        current: { from: monday, to: today },
        baseline: { from: addDays(monday, -7), to: addDays(monday, -1) },
        currentLabel: 'This week',
        baselineLabel: 'Last week',
      };
    }
    case 'month': {
      const firstOfMonth = toIsoDay(new Date(date.getFullYear(), date.getMonth(), 1));
      return {
        current: { from: firstOfMonth, to: today },
        baseline: {
          from: toIsoDay(new Date(date.getFullYear(), date.getMonth() - 1, 1)),
          to: addDays(firstOfMonth, -1),
        },
        currentLabel: 'This month',
        baselineLabel: 'Last month',
      };
    }
    case 'year': {
      const year = date.getFullYear();
      return {
        current: { from: `${year}-01-01`, to: today },
        baseline: { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
        currentLabel: 'This year',
        baselineLabel: 'Last year',
      };
    }
  }
}
