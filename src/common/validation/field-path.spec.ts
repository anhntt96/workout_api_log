import { formatFieldPath } from './field-path.js';

describe('formatFieldPath', () => {
  it('joins keys with dots and indexes with brackets', () => {
    expect(formatFieldPath(['entries', 2, 'sets', 0, 'weight'])).toBe('entries[2].sets[0].weight');
  });

  it('returns a single key unchanged', () => {
    expect(formatFieldPath(['exerciseName'])).toBe('exerciseName');
  });

  it('returns an empty string for the root', () => {
    expect(formatFieldPath([])).toBe('');
  });
});
