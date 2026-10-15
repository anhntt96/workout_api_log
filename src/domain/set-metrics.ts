import { Decimal } from 'decimal.js';
import { roundForStorage } from './weight-units.js';

/** A logged set with its weight normalized to kilograms. */
export interface NormalizedSet {
  reps: number;
  weightKg: Decimal;
}

/** Per-entry PR summary stored on `workout_entries` (ADR 0001), at storage precision. */
export interface EntrySummary {
  bestWeightKg: Decimal;
  bestVolumeKg: Decimal;
  bestE1rmKg: Decimal;
}

/** Volume of one set: reps × weight. */
export function setVolume(reps: number, weight: Decimal.Value): Decimal {
  return new Decimal(weight).times(reps);
}

/**
 * Estimated one-rep max with the Epley formula exactly as the brief defines it:
 * weight × (1 + reps / 30). A single rep therefore gives weight × 1.0333.
 * It is evaluated as weight × (reps + 30) / 30, so the only division is the last one and
 * exact half-up ties are not truncated by an inexact reps / 30.
 */
export function epleyOneRepMax(reps: number, weight: Decimal.Value): Decimal {
  return new Decimal(weight).times(new Decimal(reps).plus(30)).div(30);
}

/** The best value of each metric across an entry's sets; the metrics may come from different sets. */
export function summarizeSets(sets: readonly NormalizedSet[]): EntrySummary {
  if (sets.length === 0) {
    throw new Error('Cannot summarize an entry without sets');
  }
  const best = (values: Decimal[]): Decimal => roundForStorage(Decimal.max(...values));
  return {
    bestWeightKg: best(sets.map((set) => set.weightKg)),
    bestVolumeKg: best(sets.map((set) => setVolume(set.reps, set.weightKg))),
    bestE1rmKg: best(sets.map((set) => epleyOneRepMax(set.reps, set.weightKg))),
  };
}
