import { CATALOG, makeEntry } from '../../test/fixtures';
import { entryStats, groupByDay, muscleGroupOptions, muscleGroupsByExercise } from './history-view';

describe('groupByDay', () => {
  it('groups adjacent entries of the same day, keeping the order', () => {
    const a = makeEntry({ date: '2026-10-14' });
    const b = makeEntry({ date: '2026-10-14' });
    const c = makeEntry({ date: '2026-10-10' });

    expect(groupByDay([a, b, c])).toEqual([
      { day: '2026-10-14', entries: [a, b] },
      { day: '2026-10-10', entries: [c] },
    ]);
  });

  it('returns no groups for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('entryStats', () => {
  it('counts sets, sums volume and finds the top weight', () => {
    const stats = entryStats([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 3, weight: 105, unit: 'kg' },
    ]);
    expect(stats).toEqual({ setCount: 2, volume: 815, topWeight: 105 });
  });

  it('rounds float sums to 2 decimals', () => {
    expect(entryStats([{ reps: 3, weight: 220.46, unit: 'lb' }]).volume).toBe(661.38);
  });

  it('handles bodyweight sets', () => {
    expect(entryStats([{ reps: 10, weight: 0, unit: 'kg' }])).toEqual({
      setCount: 1,
      volume: 0,
      topWeight: 0,
    });
  });
});

describe('catalog helpers', () => {
  it('lists each muscle group once, alphabetically', () => {
    expect(muscleGroupOptions(CATALOG)).toEqual([
      'back',
      'biceps',
      'chest',
      'core',
      'glutes',
      'hamstrings',
      'quadriceps',
      'shoulders',
      'triceps',
    ]);
  });

  it('maps exercise names to their muscle groups', () => {
    expect(muscleGroupsByExercise(CATALOG).get('Pull-Up')).toEqual(['back', 'biceps']);
  });
});
