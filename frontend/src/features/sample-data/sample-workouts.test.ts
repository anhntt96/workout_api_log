import { SAMPLE_EXERCISES, buildSampleWorkouts, sampleDataKey } from './sample-workouts';

// The backend's seeded catalog (migrations/0002_seed_exercise_catalog.sql).
const CATALOG_NAMES = [
  'Back Squat',
  'Barbell Row',
  'Bench Press',
  'Bicep Curl',
  'Calf Raise',
  'Deadlift',
  'Front Squat',
  'Hip Thrust',
  'Incline Bench Press',
  'Lat Pulldown',
  'Leg Press',
  'Overhead Press',
  'Pull-Up',
  'Romanian Deadlift',
  'Tricep Pushdown',
  'Walking Lunge',
];

describe('buildSampleWorkouts', () => {
  const entries = buildSampleWorkouts('2026-10-16');
  const sets = entries.flatMap((entry) => entry.sets);

  it('fits in one request', () => {
    expect(entries).toHaveLength(48);
    for (const entry of entries) expect(entry.sets.length).toBeLessThanOrEqual(50);
  });

  it('spans the eight weeks up to today, never the future', () => {
    const dates = entries.map((entry) => entry.date).sort();
    expect(dates[0]).toBe('2026-08-25');
    expect(dates.at(-1)).toBe('2026-10-16');
  });

  it('covers this month and last month, so the default comparison has data', () => {
    expect(entries.some((entry) => entry.date.startsWith('2026-10'))).toBe(true);
    expect(entries.some((entry) => entry.date.startsWith('2026-09'))).toBe(true);
  });

  it('logs exactly the exercises it names', () => {
    expect(new Set(entries.map((entry) => entry.exerciseName))).toEqual(new Set(SAMPLE_EXERCISES));
  });

  it('uses catalog exercises only', () => {
    for (const entry of entries) expect(CATALOG_NAMES).toContain(entry.exerciseName);
  });

  it('stays within the API limits and mixes units and bodyweight sets', () => {
    for (const set of sets) {
      expect(Number.isInteger(set.reps) && set.reps! >= 1 && set.reps! <= 1000).toBe(true);
      expect(set.weight! >= 0 && set.weight! <= 5000).toBe(true);
    }
    expect(new Set(sets.map((set) => set.unit))).toEqual(new Set(['kg', 'lb']));
    expect(sets.some((set) => set.weight === 0)).toBe(true);
  });

  it('is deterministic for a given day', () => {
    expect(buildSampleWorkouts('2026-10-16')).toEqual(entries);
  });
});

describe('sampleDataKey', () => {
  it('is a valid Idempotency-Key (visible ASCII, at most 200 characters) per client', () => {
    const key = sampleDataKey('0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
    expect(key).toBe('sample-data-0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e');
    expect(key).toMatch(/^[\x21-\x7e]{1,200}$/);
  });
});
