import { presentEntry } from './workout-entry.presenter.js';
import type { WorkoutEntry } from './workout-entry.js';

const entry: WorkoutEntry = {
  id: 'e1',
  userId: 'u1',
  exerciseName: 'Bench Press',
  performedOn: '2026-10-14',
  createdAt: '2026-10-15T09:09:08.404114Z',
  sets: [
    { reps: 5, weight: '100.000', unit: 'kg', weightKg: '100.000' },
    { reps: 8, weight: '225.000', unit: 'lb', weightKg: '102.058' },
  ],
};

describe('presentEntry', () => {
  it('returns sets as logged when no unit is requested', () => {
    expect(presentEntry(entry)).toEqual({
      id: 'e1',
      userId: 'u1',
      date: '2026-10-14',
      exerciseName: 'Bench Press',
      sets: [
        { reps: 5, weight: 100, unit: 'kg' },
        { reps: 8, weight: 225, unit: 'lb' },
      ],
      createdAt: '2026-10-15T09:09:08.404114Z',
    });
  });

  it('converts other units and keeps sets already in the requested unit exact', () => {
    expect(presentEntry(entry, 'lb').sets).toEqual([
      { reps: 5, weight: 220.46, unit: 'lb' },
      { reps: 8, weight: 225, unit: 'lb' },
    ]);
    expect(presentEntry(entry, 'kg').sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 8, weight: 102.06, unit: 'kg' },
    ]);
  });
});
