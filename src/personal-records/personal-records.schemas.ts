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
