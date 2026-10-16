import {
  capitalize,
  formatNumber,
  formatReps,
  formatSet,
  formatSignedPercent,
  formatSignedWeight,
  formatWeight,
} from './format';

describe('number formatting', () => {
  it('groups thousands and keeps at most two decimals', () => {
    expect(formatNumber(1215)).toBe('1,215');
    expect(formatNumber(128.333)).toBe('128.33');
    expect(formatNumber(100.125)).toBe('100.13');
    expect(formatWeight(102.5, 'kg')).toBe('102.5 kg');
  });

  it('signs non-zero changes', () => {
    expect(formatSignedWeight(5, 'kg')).toBe('+5 kg');
    expect(formatSignedWeight(-170, 'lb')).toBe('-170 lb');
    expect(formatSignedWeight(0, 'kg')).toBe('0 kg');
    expect(formatSignedPercent(4.76)).toBe('+4.76%');
    expect(formatSignedPercent(-34)).toBe('-34%');
  });
});

describe('set formatting', () => {
  it('pluralizes reps', () => {
    expect(formatReps(1)).toBe('1 rep');
    expect(formatReps(5)).toBe('5 reps');
  });

  it('shows reps × weight, or BW for bodyweight sets', () => {
    expect(formatSet({ reps: 5, weight: 100, unit: 'kg' })).toBe('5 × 100 kg');
    expect(formatSet({ reps: 10, weight: 0, unit: 'lb' })).toBe('10 × BW');
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter', () => {
    expect(capitalize('quadriceps')).toBe('Quadriceps');
  });
});
