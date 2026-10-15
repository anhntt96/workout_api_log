import { Injectable } from '@nestjs/common';
import { RequestValidationError } from '../common/errors/request-validation.error.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { type PersonalRecords, type RecordChanges, compareRecords, toPersonalRecords } from './personal-records.js';
import { PersonalRecordsRepository } from './personal-records.repository.js';
import type { PersonalRecordsQuery, RecordsComparisonQuery } from './personal-records.schemas.js';

export interface ExerciseRecords {
  exercise: ExerciseRef;
  records: PersonalRecords;
}

export interface RecordsComparison {
  exercise: ExerciseRef;
  current: PersonalRecords;
  baseline: PersonalRecords;
  change: RecordChanges;
}

@Injectable()
export class PersonalRecordsService {
  constructor(
    private readonly records: PersonalRecordsRepository,
    private readonly exercises: ExercisesRepository,
  ) {}

  /** A user's records for one exercise, all-time or within an inclusive date range. */
  async getRecords(userId: string, query: PersonalRecordsQuery): Promise<ExerciseRecords> {
    const exercise = await this.resolveExercise(query.exerciseName);
    const rows = await this.records.findRecordRows({
      userId,
      exerciseId: exercise.id,
      from: query.from,
      to: query.to,
    });
    return { exercise, records: toPersonalRecords(rows, query.unit) };
  }

  /** Records in the current range against a baseline range, e.g. this month vs last month. */
  async compare(userId: string, query: RecordsComparisonQuery): Promise<RecordsComparison> {
    const exercise = await this.resolveExercise(query.exerciseName);
    const [currentRows, baselineRows] = await Promise.all([
      this.records.findRecordRows({ userId, exerciseId: exercise.id, from: query.from, to: query.to }),
      this.records.findRecordRows({
        userId,
        exerciseId: exercise.id,
        from: query.baselineFrom,
        to: query.baselineTo,
      }),
    ]);
    const current = toPersonalRecords(currentRows, query.unit);
    const baseline = toPersonalRecords(baselineRows, query.unit);
    return { exercise, current, baseline, change: compareRecords(current, baseline) };
  }

  /** Resolves `exerciseName` in the catalog, or fails with a 400 naming the field (ADR 0004). */
  private async resolveExercise(name: string): Promise<ExerciseRef> {
    const exercise = (await this.exercises.resolveNames([name])).get(exerciseKey(name));
    if (exercise === undefined) {
      throw new RequestValidationError([unknownExercise('exerciseName', name)]);
    }
    return exercise;
  }
}
