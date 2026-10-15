import { z } from 'zod';
import { exerciseNameSchema, plainDateSchema, weightUnitSchema } from '../common/validation/schemas.js';

export const personalRecordsQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema(),
    unit: weightUnitSchema.default('kg'),
    from: plainDateSchema('from').optional(),
    to: plainDateSchema('to').optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type PersonalRecordsQuery = z.output<typeof personalRecordsQuerySchema>;

export const recordsComparisonQuerySchema = z
  .strictObject({
    exerciseName: exerciseNameSchema(),
    unit: weightUnitSchema.default('kg'),
    from: plainDateSchema('from'),
    to: plainDateSchema('to'),
    baselineFrom: plainDateSchema('baselineFrom'),
    baselineTo: plainDateSchema('baselineTo'),
  })
  .refine((query) => query.from <= query.to, { message: 'from must be on or before to', path: ['from'] })
  .refine((query) => query.baselineFrom <= query.baselineTo, {
    message: 'baselineFrom must be on or before baselineTo',
    path: ['baselineFrom'],
  });

export type RecordsComparisonQuery = z.output<typeof recordsComparisonQuerySchema>;
