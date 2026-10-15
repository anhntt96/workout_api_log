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
import { encodeCursor } from './history-cursor.js';
import { entryIdempotencyKey } from './idempotency-key.js';
import { type InsertResult, WorkoutEntriesRepository } from './workout-entries.repository.js';
import type { HistoryQuery, LogEntriesBody, LogEntryInput } from './workout-entries.schemas.js';
import type { NewEntry, WorkoutEntry } from './workout-entry.js';

export interface HistoryPage {
  entries: WorkoutEntry[];
  /** Cursor for the next page, or null on the last page. */
  nextCursor: string | null;
}

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
   * With an idempotency key, a retry returns the entries stored the first time (ADR 0003).
   */
  async logEntries(userId: string, body: LogEntriesBody, idempotencyKey?: string): Promise<InsertResult> {
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
        const key = idempotencyKey === undefined ? null : entryIdempotencyKey(idempotencyKey, index);
        newEntries.push(toNewEntry(entry, exercise, key));
      }
    });
    if (errors.length > 0) throw new RequestValidationError(errors);
    return this.entries.insertEntries(userId, newEntries);
  }

  /** One page of a user's history, newest first, with optional exercise, muscle group and date filters. */
  async history(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    if (query.muscleGroup !== undefined) {
      await this.assertKnownMuscleGroup(query.muscleGroup);
    }
    let exerciseIds: string[] | undefined;
    if (query.exerciseName !== undefined || query.muscleGroup !== undefined) {
      // Resolve the filters on the small exercises table first, then scan only the user's entries.
      exerciseIds = await this.exercises.findIds({ nameContains: query.exerciseName, muscleGroup: query.muscleGroup });
      if (exerciseIds.length === 0) return { entries: [], nextCursor: null };
    }
    const rows = await this.entries.findHistoryPage({
      userId,
      exerciseIds,
      from: query.from,
      to: query.to,
      after: query.cursor,
      limit: query.limit + 1, // one extra row tells us whether another page exists
    });
    const entries = rows.slice(0, query.limit);
    const last = entries.at(-1);
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ performedOn: last.performedOn, createdAt: last.createdAt, id: last.id })
        : null;
    return { entries, nextCursor };
  }

  private async assertKnownMuscleGroup(name: string): Promise<void> {
    const groups = await this.exercises.listMuscleGroups();
    if (!groups.some((group) => group.toLowerCase() === name.toLowerCase())) {
      throw new RequestValidationError([
        { field: 'muscleGroup', message: `Unknown muscle group "${name}". Valid muscle groups: ${groups.join(', ')}` },
      ]);
    }
  }
}

/** Normalizes weights to kilograms and computes the per-entry PR summary (ADR 0001). */
function toNewEntry(entry: LogEntryInput, exercise: ExerciseRef, idempotencyKey: string | null): NewEntry {
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
    idempotencyKey,
    summary: summarizeSets(sets),
    sets,
  };
}
