import { Controller, Get, Param, Query } from '@nestjs/common';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  type PersonalRecordsResponse,
  type RecordsComparisonResponse,
  hasAnyRecord,
  presentRecords,
} from './personal-records.js';
import {
  type PersonalRecordsQuery,
  type RecordsComparisonQuery,
  personalRecordsQuerySchema,
  recordsComparisonQuerySchema,
} from './personal-records.schemas.js';
import { PersonalRecordsService } from './personal-records.service.js';

@Controller('users/:userId/personal-records')
export class PersonalRecordsController {
  constructor(private readonly service: PersonalRecordsService) {}

  /** Heaviest set, highest-volume set and best estimated 1RM for one exercise, all-time or in a range. */
  @Get()
  async getRecords(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(personalRecordsQuerySchema)) query: PersonalRecordsQuery,
  ): Promise<PersonalRecordsResponse> {
    const { exercise, records } = await this.service.getRecords(userId, query);
    const ranged = query.from !== undefined || query.to !== undefined;
    return {
      data: {
        exerciseName: exercise.name,
        unit: query.unit,
        from: query.from ?? null,
        to: query.to ?? null,
        records: presentRecords(records),
      },
      ...(hasAnyRecord(records)
        ? {}
        : { message: `No ${exercise.name} entries found for this user${ranged ? ' in the given date range' : ''}.` }),
    };
  }

  /** Records in one date range against a baseline range, e.g. this month vs last month (ADR 0002). */
  @Get('comparison')
  async compare(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(recordsComparisonQuerySchema)) query: RecordsComparisonQuery,
  ): Promise<RecordsComparisonResponse> {
    const result = await this.service.compare(userId, query);
    const noData = !hasAnyRecord(result.current) && !hasAnyRecord(result.baseline);
    return {
      data: {
        exerciseName: result.exercise.name,
        unit: query.unit,
        current: { from: query.from, to: query.to, records: presentRecords(result.current) },
        baseline: { from: query.baselineFrom, to: query.baselineTo, records: presentRecords(result.baseline) },
        change: result.change,
      },
      ...(noData ? { message: `No ${result.exercise.name} entries found for this user in either date range.` } : {}),
    };
  }
}
