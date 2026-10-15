import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { parseIdempotencyKey } from './idempotency-key.js';
import {
  type HistoryQuery,
  type LogEntriesBody,
  historyQuerySchema,
  logEntriesBodySchema,
} from './workout-entries.schemas.js';
import { WorkoutEntriesService } from './workout-entries.service.js';
import { type EntryResponse, type HistoryResponse, presentEntry } from './workout-entry.presenter.js';

@Controller('users/:userId/workout-entries')
export class WorkoutEntriesController {
  constructor(private readonly service: WorkoutEntriesService) {}

  /**
   * Logs one or more exercise entries for a user; a bulk request is all-or-nothing.
   * With an Idempotency-Key header, a retry returns the original entries and the header
   * `Idempotent-Replayed: true`.
   */
  @Post()
  async log(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Body(new ZodValidationPipe(logEntriesBodySchema)) body: LogEntriesBody,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: EntryResponse[] }> {
    const result = await this.service.logEntries(userId, body, parseIdempotencyKey(rawIdempotencyKey));
    if (result.replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return { data: result.entries.map((entry) => presentEntry(entry)) };
  }

  /** A user's entries, newest first, filtered and paginated with an opaque cursor. */
  @Get()
  async history(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Query(new ZodValidationPipe(historyQuerySchema)) query: HistoryQuery,
  ): Promise<HistoryResponse> {
    const page = await this.service.history(userId, query);
    return {
      data: page.entries.map((entry) => presentEntry(entry, query.unit)),
      page: { limit: query.limit, nextCursor: page.nextCursor },
      ...(page.entries.length === 0 ? { message: 'No workout entries match the given filters.' } : {}),
    };
  }
}
