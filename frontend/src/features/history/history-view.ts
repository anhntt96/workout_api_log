import type { Exercise, WorkoutEntry, WorkoutSet } from '../../api/types';

export interface DayGroup {
  day: string;
  entries: WorkoutEntry[];
}

/** Groups entries by day. The API returns them newest day first, so equal days are always adjacent. */
export function groupByDay(entries: readonly WorkoutEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last !== undefined && last.day === entry.date) last.entries.push(entry);
    else groups.push({ day: entry.date, entries: [entry] });
  }
  return groups;
}

export interface EntryStats {
  setCount: number;
  /** Sum of reps × weight, rounded to 2 decimals. Display only: records come from the API. */
  volume: number;
  topWeight: number;
}

export function entryStats(sets: readonly WorkoutSet[]): EntryStats {
  let volume = 0;
  let topWeight = 0;
  for (const set of sets) {
    volume += set.reps * set.weight;
    topWeight = Math.max(topWeight, set.weight);
  }
  return { setCount: sets.length, volume: Math.round(volume * 100) / 100, topWeight };
}

/** Every muscle group in the catalog, alphabetical, for the filter. */
export function muscleGroupOptions(exercises: readonly Exercise[]): string[] {
  return [...new Set(exercises.flatMap((exercise) => exercise.muscleGroups))].sort();
}

export function muscleGroupsByExercise(exercises: readonly Exercise[]): Map<string, string[]> {
  return new Map(exercises.map((exercise) => [exercise.name, exercise.muscleGroups]));
}
