import type { z } from 'zod';
import {
  exerciseNameSchema,
  hasControlCharacter,
  plainDateSchema,
  userIdParamSchema,
  weightUnitSchema,
} from './schemas.js';

function messages(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('shared schemas', () => {
  it('normalizes units case-insensitively and lists supported units on error', () => {
    expect(weightUnitSchema.parse(' LB ')).toBe('lb');
    expect(messages(weightUnitSchema, 'stone')).toEqual(['Unsupported unit "stone". Supported units: kg, lb']);
    expect(messages(weightUnitSchema, null)).toEqual(['unit is required']);
    expect(messages(weightUnitSchema, 5)).toEqual(['unit must be a string']);
  });

  it('accepts any UUID-shaped user id, as Postgres does', () => {
    expect(userIdParamSchema.parse('11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(messages(userIdParamSchema, 'coach-42')).toEqual(['userId must be a UUID']);
  });

  it('validates calendar dates and names the field', () => {
    expect(plainDateSchema('from').parse('2026-10-01')).toBe('2026-10-01');
    expect(messages(plainDateSchema('from'), '2026-02-30')).toEqual(['from must be a date in YYYY-MM-DD format']);
    expect(messages(plainDateSchema('from'), undefined)).toEqual(['from is required']);
    expect(messages(plainDateSchema('from'), '0000-01-01')).toEqual(['from must be on or after 0001-01-01']);
    expect(messages(plainDateSchema('from'), '')).toEqual(['from must be a date in YYYY-MM-DD format']);
  });

  it('trims exercise names and rejects blank ones', () => {
    expect(exerciseNameSchema().parse('  Bench Press ')).toBe('Bench Press');
    expect(messages(exerciseNameSchema(), '   ')).toEqual(['exerciseName must not be empty']);
    expect(messages(exerciseNameSchema(), undefined)).toEqual(['exerciseName is required']);
  });

  it('rejects control characters in exercise names (Postgres text cannot store NUL)', () => {
    expect(messages(exerciseNameSchema(), 'Bench\u0000Press')).toEqual(['exerciseName must not contain control characters']);
    expect(messages(exerciseNameSchema(), 'Bench\tPress')).toEqual(['exerciseName must not contain control characters']);
    expect(hasControlCharacter('Bench Press')).toBe(false);
    expect(hasControlCharacter('Bench\u007fPress')).toBe(true);
  });
});
