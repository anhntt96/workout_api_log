import type { Exercise, Records, WorkoutEntry } from '../api/types';

export const USER_ID = '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e';

export const CATALOG: Exercise[] = [
  { name: 'Back Squat', muscleGroups: ['glutes', 'hamstrings', 'quadriceps'] },
  { name: 'Bench Press', muscleGroups: ['chest', 'shoulders', 'triceps'] },
  { name: 'Deadlift', muscleGroups: ['back', 'glutes', 'hamstrings'] },
  { name: 'Front Squat', muscleGroups: ['core', 'glutes', 'quadriceps'] },
  { name: 'Pull-Up', muscleGroups: ['back', 'biceps'] },
];

export const NO_RECORDS: Records = { maxWeight: null, maxVolume: null, bestE1rm: null };

let nextId = 1;

export function makeEntry(overrides: Partial<WorkoutEntry> = {}): WorkoutEntry {
  const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
  return {
    id,
    userId: USER_ID,
    date: '2026-10-14',
    exerciseName: 'Bench Press',
    sets: [{ reps: 5, weight: 100, unit: 'kg' }],
    createdAt: '2026-10-14T09:00:00.000Z',
    ...overrides,
  };
}

/** Makes `crypto.randomUUID` undefined, as browsers do on plain-http origins other than localhost. Returns a restore function. */
export function hideRandomUuid(): () => void {
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  return () => {
    delete (crypto as unknown as { randomUUID?: unknown }).randomUUID;
  };
}
