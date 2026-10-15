import { z } from 'zod';
import { WEIGHT_UNITS, type WeightUnit, isWeightUnit } from '../../domain/weight-units.js';

/** Zod error option: "<field> is required" when missing or null, "<field> must be <expected>" otherwise. */
export function requiredError(field: string, expected: string) {
  return {
    error: (issue: { input?: unknown }) =>
      issue.input === undefined || issue.input === null ? `${field} is required` : `${field} must be ${expected}`,
  };
}

/** Any UUID-shaped id (8-4-4-4-12 hex), the same set Postgres `uuid` accepts. */
export const userIdParamSchema = z.guid({ error: 'userId must be a UUID' });

/** A real calendar day in YYYY-MM-DD form. */
export function plainDateSchema(field: string) {
  return z.iso.date(requiredError(field, 'a date in YYYY-MM-DD format'));
}

export function exerciseNameSchema(field = 'exerciseName') {
  return z
    .string(requiredError(field, 'a string'))
    .trim()
    .min(1, `${field} must not be empty`)
    .max(100, `${field} must be at most 100 characters`);
}

/** A unit from the weight-unit registry, matched case-insensitively. */
export const weightUnitSchema = z
  .string(requiredError('unit', 'a string'))
  .trim()
  .toLowerCase()
  .transform((value, ctx): WeightUnit => {
    if (isWeightUnit(value)) return value;
    ctx.addIssue({
      code: 'custom',
      message: `Unsupported unit "${value}". Supported units: ${WEIGHT_UNITS.join(', ')}`,
    });
    return z.NEVER;
  });
