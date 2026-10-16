import request from 'supertest';
import { entriesOf, entry, logOk, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

interface InvalidQueryCase {
  name: string;
  query: Record<string, string | number>;
  field: string;
  message: string;
}

describe('GET /users/:userId/workout-entries', () => {
  let t: TestApp;

  const get = (userId: string, query: Record<string, string | number> = {}) =>
    request(t.app.getHttpServer()).get(`/users/${userId}/workout-entries`).query(query);
  const log = (entries: unknown[], userId = USER_A) => logOk(t.app, userId, entries);

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it("lists the user's entries newest first; within a day, most recently logged first", async () => {
    await log([entry('2026-10-01', 'Deadlift')]);
    await log([entry('2026-10-03', 'Bench Press')]);
    await log([entry('2026-10-01', 'Back Squat')]);
    await log([entry('2026-10-05', 'Pull-Up')], USER_B);
    const res = await get(USER_A);
    expect(res.status).toBe(200);
    expect(entriesOf(res).map((e) => [e.date, e.exerciseName])).toEqual([
      ['2026-10-03', 'Bench Press'],
      ['2026-10-01', 'Back Squat'],
      ['2026-10-01', 'Deadlift'],
    ]);
    expect(res.body.page).toEqual({ limit: 20, nextCursor: null });
    expect(res.body).not.toHaveProperty('message');
  });

  it('filters by partial exercise name, case-insensitively', async () => {
    await log([
      entry('2026-10-01', 'Back Squat'),
      entry('2026-10-02', 'Front Squat'),
      entry('2026-10-03', 'Deadlift'),
    ]);
    expect(entriesOf(await get(USER_A, { exerciseName: 'SQUAT' })).map((e) => e.exerciseName)).toEqual([
      'Front Squat',
      'Back Squat',
    ]);
  });

  it('treats % and _ in the exercise name filter literally', async () => {
    await log([entry('2026-10-01', 'Back Squat')]);
    for (const pattern of ['%', '_']) {
      const res = await get(USER_A, { exerciseName: pattern });
      expect(res.status).toBe(200);
      expect(entriesOf(res)).toEqual([]);
    }
  });

  it('filters by muscle group through the exercise mapping', async () => {
    await log([
      entry('2026-10-01', 'Bench Press'),
      entry('2026-10-02', 'Deadlift'),
      entry('2026-10-03', 'Pull-Up'),
    ]);
    expect(entriesOf(await get(USER_A, { muscleGroup: 'Back' })).map((e) => e.exerciseName)).toEqual([
      'Pull-Up',
      'Deadlift',
    ]);
  });

  it('follows changes to the muscle-group mapping without touching stored entries', async () => {
    await log([entry('2026-10-01', 'Calf Raise')]);
    expect(entriesOf(await get(USER_A, { muscleGroup: 'core' }))).toEqual([]);
    await t.pool.query(
      `INSERT INTO exercise_muscle_groups (exercise_id, muscle_group_id)
       SELECT e.id, m.id FROM exercises e, muscle_groups m WHERE e.name = 'Calf Raise' AND m.name = 'core'`,
    );
    try {
      expect(entriesOf(await get(USER_A, { muscleGroup: 'core' })).map((e) => e.exerciseName)).toEqual([
        'Calf Raise',
      ]);
    } finally {
      await t.pool.query(
        `DELETE FROM exercise_muscle_groups em USING exercises e, muscle_groups m
         WHERE em.exercise_id = e.id AND em.muscle_group_id = m.id AND e.name = 'Calf Raise' AND m.name = 'core'`,
      );
    }
  });

  it('rejects an unknown muscle group and lists the valid ones', async () => {
    const res = await get(USER_A, { muscleGroup: 'wings' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      {
        field: 'muscleGroup',
        message:
          'Unknown muscle group "wings". Valid muscle groups: back, biceps, calves, chest, core, glutes, hamstrings, quadriceps, shoulders, triceps',
      },
    ]);
  });

  it('filters by an inclusive date range', async () => {
    await log(
      ['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-16'].map((date) => entry(date, 'Deadlift')),
    );
    expect(entriesOf(await get(USER_A, { from: '2026-10-01', to: '2026-10-15' })).map((e) => e.date)).toEqual(
      ['2026-10-15', '2026-10-01'],
    );
  });

  it('returns an empty list with a message for a range without data', async () => {
    await log([entry('2026-10-01', 'Deadlift')]);
    const res = await get(USER_A, { from: '2025-01-01', to: '2025-01-31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      page: { limit: 20, nextCursor: null },
      message: 'No workout entries match the given filters.',
    });
  });

  it('converts weights to the requested unit and keeps sets already in that unit exact', async () => {
    await log([entry('2026-10-01', 'Bench Press', [set(5, 100, 'kg'), set(5, 225, 'lb')])]);
    expect(entriesOf(await get(USER_A, { unit: 'lb' }))[0].sets).toEqual([
      { reps: 5, weight: 220.46, unit: 'lb' },
      { reps: 5, weight: 225, unit: 'lb' },
    ]);
    expect(entriesOf(await get(USER_A, { unit: 'KG' }))[0].sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 5, weight: 102.06, unit: 'kg' },
    ]);
    expect(entriesOf(await get(USER_A))[0].sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 5, weight: 225, unit: 'lb' },
    ]);
  });

  it('pages through entries that share a day and a timestamp without gaps or repeats', async () => {
    // One bulk request: all 25 entries share performed_on and created_at, so only id breaks ties.
    const logged = await log(Array.from({ length: 25 }, () => entry('2026-10-10', 'Bench Press')));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(USER_A, cursor === null ? { limit: 10 } : { limit: 10, cursor });
      expect(res.status).toBe(200);
      seen.push(...entriesOf(res).map((e) => e.id));
      cursor = res.body.page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen)).toEqual(new Set(logged.map((e) => e.id)));
  });

  it('combines filters with pagination', async () => {
    await log(Array.from({ length: 3 }, (_, i) => entry(`2026-10-0${i + 1}`, 'Bench Press')));
    await log([entry('2026-10-02', 'Deadlift')]);
    const first = await get(USER_A, { exerciseName: 'bench', limit: 2 });
    expect(entriesOf(first).map((e) => e.date)).toEqual(['2026-10-03', '2026-10-02']);
    const second = await get(USER_A, { exerciseName: 'bench', limit: 2, cursor: first.body.page.nextCursor });
    expect(entriesOf(second).map((e) => e.date)).toEqual(['2026-10-01']);
    expect(second.body.page.nextCursor).toBeNull();
  });

  const invalidQueries: InvalidQueryCase[] = [
    { name: 'limit 0', query: { limit: 0 }, field: 'limit', message: 'limit must be at least 1' },
    { name: 'limit 101', query: { limit: 101 }, field: 'limit', message: 'limit must be at most 100' },
    {
      name: 'a non-numeric limit',
      query: { limit: 'ten' },
      field: 'limit',
      message: 'limit must be a number',
    },
    {
      name: 'a reversed range',
      query: { from: '2026-10-05', to: '2026-10-01' },
      field: 'from',
      message: 'from must be on or before to',
    },
    {
      name: 'a non-ISO date',
      query: { from: '01/10/2026' },
      field: 'from',
      message: 'from must be a date in YYYY-MM-DD format',
    },
    {
      name: 'an unsupported unit',
      query: { unit: 'stone' },
      field: 'unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
    {
      name: 'a garbage cursor',
      query: { cursor: 'garbage' },
      field: 'cursor',
      message: 'cursor is invalid; use nextCursor from the previous page',
    },
    {
      name: 'a misspelled parameter',
      query: { exercise: 'bench' },
      field: 'query',
      message: 'Unrecognized key: "exercise"',
    },
    {
      name: 'a control character in the muscle group',
      query: { muscleGroup: 'back\u0000' },
      field: 'muscleGroup',
      message: 'muscleGroup must not contain control characters',
    },
    {
      name: 'a year-zero date',
      query: { from: '0000-01-01' },
      field: 'from',
      message: 'from must be on or after 0001-01-01',
    },
  ];

  it.each(invalidQueries)('rejects $name', async ({ query, field, message }) => {
    const res = await get(USER_A, query);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('rejects a repeated query parameter', async () => {
    const res = await request(t.app.getHttpServer()).get(`/users/${USER_A}/workout-entries?unit=kg&unit=lb`);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'unit', message: 'unit must be a string' }]);
  });
});
