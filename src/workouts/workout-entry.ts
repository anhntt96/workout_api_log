import type { Decimal } from 'decimal.js';
import type { EntrySummary } from '../domain/set-metrics.js';
import type { WeightUnit } from '../domain/weight-units.js';

/** A set as stored: the logged weight and unit plus the normalized kilograms (decimal strings). */
export interface StoredSet {
  reps: number;
  weight: string;
  unit: WeightUnit;
  weightKg: string;
}

export interface WorkoutEntry {
  id: string;
  userId: string;
  /** Canonical catalog name. */
  exerciseName: string;
  /** The client's calendar day, YYYY-MM-DD (ADR 0002). */
  performedOn: string;
  /** UTC with microseconds, e.g. 2026-10-15T09:09:08.404114Z; also part of the history cursor. */
  createdAt: string;
  sets: StoredSet[];
}

export interface NewSet {
  reps: number;
  weight: Decimal;
  unit: WeightUnit;
  weightKg: Decimal;
}

export interface NewEntry {
  id: string;
  exerciseId: string;
  performedOn: string;
  summary: EntrySummary;
  sets: NewSet[];
}
