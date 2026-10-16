import { dateRangeError, filtersFromParams, filtersToParams, hasActiveFilters } from './history-filters';

describe('history filters', () => {
  it('reads filters from the URL, defaulting to empty', () => {
    expect(filtersFromParams(new URLSearchParams('exercise=squat&muscle=glutes&from=2026-09-01'))).toEqual({
      exercise: 'squat',
      muscleGroup: 'glutes',
      from: '2026-09-01',
      to: '',
    });
  });

  it('writes only non-empty, trimmed filters', () => {
    const params = filtersToParams({ exercise: '  squat ', muscleGroup: '', from: '', to: '2026-09-30' });
    expect(params.toString()).toBe('exercise=squat&to=2026-09-30');
  });

  it('round-trips', () => {
    const filters = { exercise: 'bench', muscleGroup: 'chest', from: '2026-09-01', to: '2026-09-30' };
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters);
  });

  it('knows when any filter is set', () => {
    expect(hasActiveFilters({ exercise: '', muscleGroup: '', from: '', to: '' })).toBe(false);
    expect(hasActiveFilters({ exercise: ' ', muscleGroup: '', from: '', to: '' })).toBe(false);
    expect(hasActiveFilters({ exercise: '', muscleGroup: 'back', from: '', to: '' })).toBe(true);
  });

  it('flags a range that ends before it starts', () => {
    const base = { exercise: '', muscleGroup: '' };
    expect(dateRangeError({ ...base, from: '2026-10-02', to: '2026-10-01' })).toBe(
      'From must be on or before To',
    );
    expect(dateRangeError({ ...base, from: '2026-10-01', to: '2026-10-01' })).toBeNull();
    expect(dateRangeError({ ...base, from: '2026-10-02', to: '' })).toBeNull();
  });
});
