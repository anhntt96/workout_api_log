import type { LogEntryInput, WeightUnit } from '../../api/types';
import { addDays } from '../../lib/dates';

/** Days before today of the 16 sample sessions: two a week for eight weeks, the last one today. */
const SESSION_OFFSETS = [52, 49, 45, 42, 38, 35, 31, 28, 24, 21, 17, 14, 10, 7, 3, 0];

type SetSpec = readonly [reps: number, weight: number];

interface Lift {
  exerciseName: string;
  unit: WeightUnit;
  sets: (week: number) => SetSpec[];
}

/** Squat, bench (in lb) and row; week 5 adds a heavy squat single, so the squat records fall on different days. */
const SESSION_A: Lift[] = [
  {
    exerciseName: 'Back Squat',
    unit: 'kg',
    sets: (week) => [
      [5, 100 + 2.5 * week],
      [5, 100 + 2.5 * week],
      [3, 107.5 + 2.5 * week],
      ...(week === 5 ? [[1, 135] as const] : []),
    ],
  },
  {
    exerciseName: 'Bench Press',
    unit: 'lb',
    sets: (week) => [
      [8, 135 + 5 * week],
      [8, 135 + 5 * week],
      [5, 155 + 5 * week],
    ],
  },
  {
    exerciseName: 'Barbell Row',
    unit: 'kg',
    sets: (week) => [
      [10, 60 + 2.5 * week],
      [10, 60 + 2.5 * week],
      [10, 60 + 2.5 * week],
    ],
  },
];

/** Deadlift, overhead press and bodyweight pull-ups. */
const SESSION_B: Lift[] = [
  {
    exerciseName: 'Deadlift',
    unit: 'kg',
    sets: (week) => [
      [5, 140 + 5 * week],
      [3, 150 + 5 * week],
      [1, 165 + 5 * week],
    ],
  },
  {
    exerciseName: 'Overhead Press',
    unit: 'kg',
    sets: (week) => [
      [8, 40 + 1.25 * week],
      [8, 40 + 1.25 * week],
      [6, 42.5 + 1.25 * week],
    ],
  },
  {
    exerciseName: 'Pull-Up',
    unit: 'kg',
    sets: (week) => [
      [10, 0],
      [8 + (week % 3), 0],
      [8, 0],
    ],
  },
];

/** 48 entries of steady progress ending today (the API takes up to 50 per request), in kg and lb. */
export function buildSampleWorkouts(today: string): LogEntryInput[] {
  return SESSION_OFFSETS.flatMap((offset, index) => {
    const week = Math.floor(index / 2);
    const lifts = index % 2 === 0 ? SESSION_A : SESSION_B;
    return lifts.map((lift) => ({
      date: addDays(today, -offset),
      exerciseName: lift.exerciseName,
      sets: lift.sets(week).map(([reps, weight]) => ({ reps, weight, unit: lift.unit })),
    }));
  });
}

/** One key per client: loading sample data twice replays the first load instead of storing it again. */
export function sampleDataKey(userId: string): string {
  return `sample-data-${userId}`;
}
