import type { Pool } from 'pg';
import request from 'supertest';
import { ExercisesRepository, exerciseKey } from '../src/exercises/exercises.repository.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

async function namesOf(pool: Pool, ids: string[]): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name::text AS name FROM exercises WHERE id = ANY($1::uuid[]) ORDER BY name',
    [ids],
  );
  return rows.map((row) => row.name);
}

describe('exercise catalog', () => {
  let t: TestApp;
  let repository: ExercisesRepository;

  beforeAll(async () => {
    t = await createTestApp();
    repository = t.app.get(ExercisesRepository);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /exercises lists the seeded catalog with muscle groups', async () => {
    const res = await request(t.app.getHttpServer()).get('/exercises');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(16);
    expect(res.body.data).toContainEqual({
      name: 'Bench Press',
      muscleGroups: ['chest', 'shoulders', 'triceps'],
    });
  });

  it('resolves names trimmed and case-insensitively to the canonical name', async () => {
    const resolved = await repository.resolveNames(['  bench PRESS ', 'Deadlift', 'Benchpress']);
    expect(resolved.get(exerciseKey('  bench PRESS '))?.name).toBe('Bench Press');
    expect(resolved.get('deadlift')?.name).toBe('Deadlift');
    expect(resolved.has('benchpress')).toBe(false);
  });

  it('finds exercises by partial name, case-insensitively', async () => {
    expect(await namesOf(t.pool, await repository.findIds({ nameContains: 'SQUAT' }))).toEqual([
      'Back Squat',
      'Front Squat',
    ]);
  });

  it('treats LIKE wildcards in the name literally', async () => {
    await expect(repository.findIds({ nameContains: '%' })).resolves.toEqual([]);
    await expect(repository.findIds({ nameContains: '_' })).resolves.toEqual([]);
  });

  it('finds exercises by muscle group and combines both filters', async () => {
    expect(await namesOf(t.pool, await repository.findIds({ muscleGroup: 'Calves' }))).toEqual([
      'Calf Raise',
    ]);
    expect(
      await namesOf(t.pool, await repository.findIds({ nameContains: 'press', muscleGroup: 'chest' })),
    ).toEqual(['Bench Press', 'Incline Bench Press']);
  });

  it('lists muscle groups alphabetically', async () => {
    await expect(repository.listMuscleGroups()).resolves.toEqual([
      'back',
      'biceps',
      'calves',
      'chest',
      'core',
      'glutes',
      'hamstrings',
      'quadriceps',
      'shoulders',
      'triceps',
    ]);
  });
});
