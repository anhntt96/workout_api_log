import { Injectable } from '@nestjs/common';
import { RequestValidationError } from '../common/errors/request-validation.error.js';
import {
  type ExerciseRef,
  ExercisesRepository,
  exerciseKey,
  unknownExercise,
} from '../exercises/exercises.repository.js';
import { type PersonalRecords, toPersonalRecords } from './personal-records.js';
import { PersonalRecordsRepository } from './personal-records.repository.js';
import type { PersonalRecordsQuery } from './personal-records.schemas.js';

export interface ExerciseRecords {
  exercise: ExerciseRef;
  records: PersonalRecords;
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

  /** Resolves `exerciseName` in the catalog, or fails with a 400 naming the field (ADR 0004). */
  private async resolveExercise(name: string): Promise<ExerciseRef> {
    const exercise = (await this.exercises.resolveNames([name])).get(exerciseKey(name));
    if (exercise === undefined) {
      throw new RequestValidationError([unknownExercise('exerciseName', name)]);
    }
    return exercise;
  }
}
