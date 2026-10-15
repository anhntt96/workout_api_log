import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../common/clock.js';
import { type FieldError, RequestValidationError } from '../common/errors/request-validation.error.js';
import { summarizeSets } from '../domain/set-metrics.js';
import { convertWeight, roundForStorage } from '../domain/weight-units.js';
import { latestAllowedWorkoutDate } from '../domain/workout-date.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { WorkoutEntriesRepository } from './workout-entries.repository.js';
import type { LogEntriesBody, LogEntryInput } from './workout-entries.schemas.js';
import type { NewEntry, WorkoutEntry } from './workout-entry.js';

@Injectable()
export class WorkoutEntriesService {
  constructor(
    private readonly entries: WorkoutEntriesRepository,
    private readonly exercises: ExercisesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Logs one or more entries for a user. Every entry is checked first and all problems are
   * reported together; then everything is written in one transaction (all-or-nothing, ADR 0004).
   */
  async logEntries(userId: string, body: LogEntriesBody): Promise<WorkoutEntry[]> {
    const exercises = await this.exercises.resolveNames(body.entries.map((entry) => entry.exerciseName));
    const latestDate = latestAllowedWorkoutDate(this.clock.now());
    const errors: FieldError[] = [];
    const newEntries: NewEntry[] = [];
    body.entries.forEach((entry, index) => {
      if (entry.date > latestDate) {
        errors.push({
          field: `entries[${index}].date`,
          message: `date must not be after ${latestDate} (more than one day in the future)`,
        });
      }
      const exercise = exercises.get(exerciseKey(entry.exerciseName));
      if (exercise === undefined) {
        errors.push(unknownExercise(`entries[${index}].exerciseName`, entry.exerciseName));
      } else {
        newEntries.push(toNewEntry(entry, exercise));
      }
    });
    if (errors.length > 0) throw new RequestValidationError(errors);
    return this.entries.insertEntries(userId, newEntries);
  }
}

/** Normalizes weights to kilograms and computes the per-entry PR summary (ADR 0001). */
function toNewEntry(entry: LogEntryInput, exercise: ExerciseRef): NewEntry {
  const sets = entry.sets.map((set) => {
    const weight = roundForStorage(new Decimal(set.weight));
    return {
      reps: set.reps,
      weight,
      unit: set.unit,
      weightKg: roundForStorage(convertWeight(weight, set.unit, 'kg')),
    };
  });
  return {
    id: randomUUID(),
    exerciseId: exercise.id,
    performedOn: entry.date,
    summary: summarizeSets(sets),
    sets,
  };
}
