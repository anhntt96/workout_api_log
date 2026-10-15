import { Body, Controller, Param, Post } from '@nestjs/common';
import { userIdParamSchema } from '../common/validation/schemas.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { type LogEntriesBody, logEntriesBodySchema } from './workout-entries.schemas.js';
import { WorkoutEntriesService } from './workout-entries.service.js';
import { type EntryResponse, presentEntry } from './workout-entry.presenter.js';

@Controller('users/:userId/workout-entries')
export class WorkoutEntriesController {
  constructor(private readonly service: WorkoutEntriesService) {}

  /** Logs one or more exercise entries for a user; a bulk request is all-or-nothing. */
  @Post()
  async log(
    @Param('userId', new ZodValidationPipe(userIdParamSchema)) userId: string,
    @Body(new ZodValidationPipe(logEntriesBodySchema)) body: LogEntriesBody,
  ): Promise<{ data: EntryResponse[] }> {
    const entries = await this.service.logEntries(userId, body);
    return { data: entries.map((entry) => presentEntry(entry)) };
  }
}
