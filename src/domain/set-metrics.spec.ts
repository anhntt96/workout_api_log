import { Decimal } from 'decimal.js';
import { epleyOneRepMax, setVolume, summarizeSets } from './set-metrics.js';
import { roundForStorage } from './weight-units.js';

const kg = (value: string | number) => new Decimal(value);

describe('setVolume', () => {
  it('multiplies reps by weight', () => {
    expect(setVolume(10, 60).toString()).toBe('600');
  });
});

describe('epleyOneRepMax', () => {
  it('applies weight × (1 + reps / 30)', () => {
    expect(epleyOneRepMax(5, 100).toFixed(3)).toBe('116.667');
    expect(epleyOneRepMax(30, 50).toString()).toBe('100');
  });

  it('follows the brief for a single rep (3.3% above the lifted weight)', () => {
    expect(epleyOneRepMax(1, 120).toFixed(3)).toBe('124.000');
  });

  it('rounds exact half-up ties correctly (20.025 × 31/30 = 20.6925 exactly)', () => {
    // Dividing reps by 30 first would truncate 1/30 and land just below the tie.
    expect(roundForStorage(epleyOneRepMax(1, '20.025')).toString()).toBe('20.693');
  });

  it('is zero for bodyweight sets logged with zero weight', () => {
    expect(epleyOneRepMax(12, 0).isZero()).toBe(true);
  });
});

describe('summarizeSets', () => {
  it('takes each metric from whichever set maximizes it', () => {
    const summary = summarizeSets([
      { reps: 1, weightKg: kg(120) }, // heaviest (e1RM 124)
      { reps: 10, weightKg: kg(80) }, // most volume: 800
      { reps: 5, weightKg: kg(110) }, // best e1RM: 128.333
    ]);
    expect(summary.bestWeightKg.toFixed(3)).toBe('120.000');
    expect(summary.bestVolumeKg.toFixed(3)).toBe('800.000');
    expect(summary.bestE1rmKg.toFixed(3)).toBe('128.333');
  });

  it('rounds to storage precision', () => {
    // 45.359 × (1 + 7/30) = 55.94276…
    expect(summarizeSets([{ reps: 7, weightKg: kg('45.359') }]).bestE1rmKg.toString()).toBe('55.943');
  });

  it('rejects an entry without sets', () => {
    expect(() => summarizeSets([])).toThrow('Cannot summarize an entry without sets');
  });
});
