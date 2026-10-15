import request from 'supertest';
import { countEntries, entriesOf, entry, fieldsOf, logEntries, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface InvalidCase {
  name: string;
  override: Record<string, unknown>;
  field: string;
  message: unknown;
}

describe('POST /users/:userId/workout-entries', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('logs an entry and returns it with the canonical exercise name', async () => {
    const res = await logEntries(t.app, USER_A, [entry('2026-10-14', '  bench PRESS ', [set(5, 100), set(3, 102.5)])]);
    expect(res.status).toBe(201);
    expect(entriesOf(res)).toEqual([
      {
        id: expect.stringMatching(UUID),
        userId: USER_A,
        date: '2026-10-14',
        exerciseName: 'Bench Press',
        sets: [
          { reps: 5, weight: 100, unit: 'kg' },
          { reps: 3, weight: 102.5, unit: 'kg' },
        ],
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      },
    ]);
  });

  it('logs several exercises in one request, in request order', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Back Squat'),
      entry('2026-10-14', 'Bench Press'),
      entry('2026-10-13', 'Deadlift'),
    ]);
    expect(res.status).toBe(201);
    expect(entriesOf(res).map((e) => e.exerciseName)).toEqual(['Back Squat', 'Bench Press', 'Deadlift']);
    expect(await countEntries(t.pool)).toBe(3);
  });

  it('stores the logged weight and unit next to normalized kilograms and the PR summary', async () => {
    const res = await logEntries(t.app, USER_A, [entry('2026-10-14', 'Deadlift', [set(5, 225, 'lb'), set(1, 300, 'LB')])]);
    expect(res.status).toBe(201);
    const id = entriesOf(res)[0].id;
    const sets = await t.pool.query(
      'SELECT set_index, reps, weight::text, unit, weight_kg::text FROM workout_sets WHERE entry_id = $1 ORDER BY set_index',
      [id],
    );
    expect(sets.rows).toEqual([
      { set_index: 0, reps: 5, weight: '225.000', unit: 'lb', weight_kg: '102.058' },
      { set_index: 1, reps: 1, weight: '300.000', unit: 'lb', weight_kg: '136.078' },
    ]);
    const summary = await t.pool.query(
      'SELECT best_weight_kg::text, best_volume_kg::text, best_e1rm_kg::text FROM workout_entries WHERE id = $1',
      [id],
    );
    // Volume: 5 × 102.058; e1RM: 136.078 × (1 + 1/30) = 140.6139…
    expect(summary.rows[0]).toEqual({ best_weight_kg: '136.078', best_volume_kg: '510.290', best_e1rm_kg: '140.614' });
  });

  it("reads the date in the client's offset, never converting to UTC", async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14T06:00:00+07:00', 'Back Squat'),
      entry('2026-10-14T23:30:00-05:00', 'Back Squat'),
    ]);
    expect(res.status).toBe(201);
    expect(entriesOf(res).map((e) => e.date)).toEqual(['2026-10-14', '2026-10-14']);
  });

  it('accepts a day one past the UTC date and rejects later days', async () => {
    expect((await logEntries(t.app, USER_A, [entry('2026-10-16', 'Deadlift')])).status).toBe(201);
    const tooLate = await logEntries(t.app, USER_A, [entry('2026-10-17', 'Deadlift')]);
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.errors).toEqual([
      { field: 'entries[0].date', message: 'date must not be after 2026-10-16 (more than one day in the future)' },
    ]);
  });

  it('rejects unknown exercises, naming each field, and stores nothing from the request', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Bench Press'),
      entry('2026-10-14', 'Squat'),
      entry('2026-10-14', 'Benchpress'),
    ]);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'entries[1].exerciseName', message: 'Unknown exercise "Squat". GET /exercises lists the valid names' },
        { field: 'entries[2].exerciseName', message: 'Unknown exercise "Benchpress". GET /exercises lists the valid names' },
      ],
    });
    expect(await countEntries(t.pool)).toBe(0);
  });

  const invalidCases: InvalidCase[] = [
    { name: 'a null date', override: { date: null }, field: 'entries[0].date', message: 'date is required' },
    {
      name: 'a datetime without an offset',
      override: { date: '2026-10-14T06:00:00' },
      field: 'entries[0].date',
      message: expect.stringContaining('must include a UTC offset'),
    },
    {
      name: 'an impossible date',
      override: { date: '2026-02-30' },
      field: 'entries[0].date',
      message: '"2026-02-30" is not a valid calendar date',
    },
    { name: 'an empty sets array', override: { sets: [] }, field: 'entries[0].sets', message: 'sets must contain at least one set' },
    {
      name: 'a negative weight',
      override: { sets: [set(5, -10)] },
      field: 'entries[0].sets[0].weight',
      message: 'weight must not be negative',
    },
    { name: 'zero reps', override: { sets: [set(0, 10)] }, field: 'entries[0].sets[0].reps', message: 'reps must be at least 1' },
    {
      name: 'fractional reps',
      override: { sets: [set(2.5, 10)] },
      field: 'entries[0].sets[0].reps',
      message: 'reps must be a whole number',
    },
    {
      name: 'an unsupported unit',
      override: { sets: [set(5, 10, 'stone')] },
      field: 'entries[0].sets[0].unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
    {
      name: 'a weight sent as a string',
      override: { sets: [{ reps: 5, weight: '100', unit: 'kg' }] },
      field: 'entries[0].sets[0].weight',
      message: 'weight must be a number',
    },
    {
      name: 'a missing exercise name',
      override: { exerciseName: undefined },
      field: 'entries[0].exerciseName',
      message: 'exerciseName is required',
    },
    { name: 'an unexpected field', override: { userId: USER_B }, field: 'entries[0]', message: 'Unrecognized key: "userId"' },
  ];

  it.each(invalidCases)('rejects $name', async ({ override, field, message }) => {
    const res = await logEntries(t.app, USER_A, [{ ...entry('2026-10-14', 'Deadlift'), ...override }]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('reports every problem in the request at once', async () => {
    const res = await logEntries(t.app, USER_A, [
      entry('2026-10-14', 'Deadlift', [set(5, -1), set(0, 10, 'oz')]),
      { exerciseName: 'Deadlift', sets: [] },
    ]);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual([
      'entries[0].sets[0].weight',
      'entries[0].sets[1].reps',
      'entries[0].sets[1].unit',
      'entries[1].date',
      'entries[1].sets',
    ]);
  });

  it.each([
    { name: 'a JSON array body', body: [], field: 'body', message: 'Request body must be a JSON object' },
    { name: 'a missing entries field', body: {}, field: 'entries', message: 'entries is required' },
    { name: 'an empty entries array', body: { entries: [] }, field: 'entries', message: 'entries must contain at least one entry' },
    {
      name: 'more than 50 entries',
      body: { entries: Array.from({ length: 51 }, () => entry('2026-10-14', 'Deadlift')) },
      field: 'entries',
      message: 'entries must contain at most 50 entries',
    },
  ])('rejects $name', async ({ body, field, message }) => {
    const res = await request(t.app.getHttpServer()).post(`/users/${USER_A}/workout-entries`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });

  it('accepts the largest allowed request (50 entries × 50 sets, over 100 kB)', async () => {
    const sets = Array.from({ length: 50 }, () => set(10, 102.125, 'lb'));
    const entries = Array.from({ length: 50 }, () => entry('2026-10-14', 'Bench Press', sets));
    expect(Buffer.byteLength(JSON.stringify({ entries }))).toBeGreaterThan(100 * 1024);
    const res = await logEntries(t.app, USER_A, entries);
    expect(res.status).toBe(201);
    expect(entriesOf(res)).toHaveLength(50);
  });

  it('rejects a user id that is not a UUID', async () => {
    const res = await logEntries(t.app, 'coach-42', [entry('2026-10-14', 'Deadlift')]);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'userId', message: 'userId must be a UUID' }]);
  });
});
