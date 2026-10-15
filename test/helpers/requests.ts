import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request, { type Response } from 'supertest';
import type { FieldError } from '../../src/common/errors/request-validation.error.js';
import type { EntryResponse } from '../../src/workouts/workout-entry.presenter.js';

export interface SetInput {
  reps: number;
  weight: number;
  unit: string;
}

export function set(reps: number, weight: number, unit = 'kg'): SetInput {
  return { reps, weight, unit };
}

export function entry(date: string, exerciseName: string, sets: SetInput[] = [set(5, 100)]) {
  return { date, exerciseName, sets };
}

export function logEntries(
  app: NestExpressApplication,
  userId: string,
  entries: unknown[],
  idempotencyKey?: string,
) {
  return request(app.getHttpServer())
    .post(`/users/${userId}/workout-entries`)
    .set(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey })
    .send({ entries });
}

/** Logs entries that must be accepted and returns them. */
export async function logOk(app: NestExpressApplication, userId: string, entries: unknown[]): Promise<EntryResponse[]> {
  const res = await logEntries(app, userId, entries);
  expect(res.status).toBe(201);
  return entriesOf(res);
}

/** The `data` array of an entries response. */
export function entriesOf(res: Response): EntryResponse[] {
  return (res.body as { data: EntryResponse[] }).data;
}

/** The `field` of every error in an error response. */
export function fieldsOf(res: Response): string[] {
  return (res.body as { errors: FieldError[] }).errors.map((error) => error.field);
}

export async function countEntries(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM workout_entries');
  return rows[0].count;
}
