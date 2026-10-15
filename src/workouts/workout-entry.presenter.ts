import { type WeightUnit, convertWeight, roundForDisplay } from '../domain/weight-units.js';
import type { StoredSet, WorkoutEntry } from './workout-entry.js';

export interface SetResponse {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

export interface EntryResponse {
  id: string;
  userId: string;
  date: string;
  exerciseName: string;
  sets: SetResponse[];
  createdAt: string;
}

/**
 * Shapes an entry for the API. With `unit`, every set is converted to it and rounded to two
 * decimals, but a set already in that unit keeps its exact logged weight. Without `unit`,
 * sets are returned as logged.
 */
export function presentEntry(entry: WorkoutEntry, unit?: WeightUnit): EntryResponse {
  return {
    id: entry.id,
    userId: entry.userId,
    date: entry.performedOn,
    exerciseName: entry.exerciseName,
    sets: entry.sets.map((set) => presentSet(set, unit)),
    createdAt: entry.createdAt,
  };
}

function presentSet(set: StoredSet, unit: WeightUnit | undefined): SetResponse {
  if (unit === undefined || unit === set.unit) {
    return { reps: set.reps, weight: Number(set.weight), unit: set.unit };
  }
  return { reps: set.reps, weight: roundForDisplay(convertWeight(set.weight, set.unit, unit)), unit };
}
