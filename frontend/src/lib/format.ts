import type { WeightUnit } from '../api/types';

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

/** 1215 → "1,215"; 128.333 → "128.33". */
export function formatNumber(value: number): string {
  return plain.format(value);
}

/** "102.5 kg" */
export function formatWeight(value: number, unit: WeightUnit): string {
  return `${formatNumber(value)} ${unit}`;
}

/** "+5 kg", "-170 kg", "0 kg" */
export function formatSignedWeight(value: number, unit: WeightUnit): string {
  return `${signed.format(value)} ${unit}`;
}

/** "+4.76%", "-34%", "0%" */
export function formatSignedPercent(value: number): string {
  return `${signed.format(value)}%`;
}

/** "1 rep", "5 reps" */
export function formatReps(reps: number): string {
  return `${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}

/** A set as "5 × 100 kg". A 0-weight set is bodyweight work: "10 × BW". */
export function formatSet(set: { reps: number; weight: number; unit: WeightUnit }): string {
  return set.weight === 0 ? `${set.reps} × BW` : `${set.reps} × ${formatWeight(set.weight, set.unit)}`;
}

/** "quadriceps" → "Quadriceps" */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
