import { z } from 'zod';
import {
  exerciseNameSchema,
  hasControlCharacter,
  plainDateSchema,
  requiredError,
  weightUnitSchema,
} from '../common/validation/schemas.js';
import { parseWorkoutDate } from '../domain/workout-date.js';
import { decodeCursor } from './history-cursor.js';

export const MAX_ENTRIES_PER_REQUEST = 50;
export const MAX_SETS_PER_ENTRY = 50;
export const MAX_REPS = 1000;
export const MAX_WEIGHT = 5000;

/** `YYYY-MM-DD` or an ISO datetime with an offset, read as the calendar day in that offset (ADR 0002). */
const workoutDateSchema = z
  .string(requiredError('date', 'a string'))
  .trim()
  .transform((value, ctx) => {
    const parsed = parseWorkoutDate(value);
    if (parsed.ok) return parsed.date;
    ctx.addIssue({ code: 'custom', message: parsed.message });
    return z.NEVER;
  });

const setSchema = z.strictObject({
  reps: z
    .number(requiredError('reps', 'a number'))
    .int('reps must be a whole number')
    .min(1, 'reps must be at least 1')
    .max(MAX_REPS, `reps must be at most ${MAX_REPS}`),
  weight: z
    .number(requiredError('weight', 'a number'))
    .min(0, 'weight must not be negative')
    .max(MAX_WEIGHT, `weight must be at most ${MAX_WEIGHT}`),
  unit: weightUnitSchema,
});

const entrySchema = z.strictObject({
  date: workoutDateSchema,
  exerciseName: exerciseNameSchema(),
  sets: z
    .array(setSchema, requiredError('sets', 'an array'))
    .min(1, 'sets must contain at least one set')
    .max(MAX_SETS_PER_ENTRY, `sets must contain at most ${MAX_SETS_PER_ENTRY} sets`),
});

export const logEntriesBodySchema = z.strictObject(
  {
    entries: z
      .array(entrySchema, requiredError('entries', 'an array'))
      .min(1, 'entries must contain at least one entry')
      .max(MAX_ENTRIES_PER_REQUEST, `entries must contain at most ${MAX_ENTRIES_PER_REQUEST} entries`),
  },
  // A function, not a string: a string would also replace the "Unrecognized key" messages.
  { error: (issue) => (issue.code === 'invalid_type' ? 'Request body must be a JSON object' : undefined) },
);

export type LogEntriesBody = z.output<typeof logEntriesBodySchema>;
export type LogEntryInput = LogEntriesBody['entries'][number];

export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 100;

export const historyQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema().optional(),
    muscleGroup: z
      .string(requiredError('muscleGroup', 'a string'))
      .trim()
      .min(1, 'muscleGroup must not be empty')
      .refine((value) => !hasControlCharacter(value), 'muscleGroup must not contain control characters')
      .optional(),
    from: plainDateSchema('from').optional(),
    to: plainDateSchema('to').optional(),
    unit: weightUnitSchema.optional(),
    limit: z.coerce
      .number({ error: 'limit must be a number' })
      .int('limit must be a whole number')
      .min(1, 'limit must be at least 1')
      .max(HISTORY_MAX_LIMIT, `limit must be at most ${HISTORY_MAX_LIMIT}`)
      .default(HISTORY_DEFAULT_LIMIT),
    cursor: z
      .string(requiredError('cursor', 'a string'))
      .transform((value, ctx) => {
        const cursor = decodeCursor(value);
        if (cursor) return cursor;
        ctx.addIssue({ code: 'custom', message: 'cursor is invalid; use nextCursor from the previous page' });
        return z.NEVER;
      })
      .optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type HistoryQuery = z.output<typeof historyQuerySchema>;
