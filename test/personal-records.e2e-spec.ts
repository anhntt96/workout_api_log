import request from 'supertest';
import { entry, logOk, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

interface InvalidQueryCase {
  name: string;
  query: Record<string, string>;
  field: string;
  message: string;
}

describe('GET /users/:userId/personal-records', () => {
  let t: TestApp;

  const getRecords = (query: Record<string, string>, userId = USER_A) =>
    request(t.app.getHttpServer()).get(`/users/${userId}/personal-records`).query(query);
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

  it('returns the heaviest set, highest-volume set and best e1RM with their dates', async () => {
    await log([entry('2026-09-02', 'Bench Press', [set(1, 120), set(10, 80)])]);
    await log([entry('2026-09-09', 'Bench Press', [set(5, 110)])]);
    await log([entry('2026-09-09', 'Deadlift', [set(1, 200)])]);
    const res = await getRecords({ exerciseName: 'bench press' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        exerciseName: 'Bench Press',
        unit: 'kg',
        from: null,
        to: null,
        records: {
          maxWeight: { value: 120, weight: 120, reps: 1, date: '2026-09-02', entryId: expect.any(String) },
          maxVolume: { value: 800, weight: 80, reps: 10, date: '2026-09-02', entryId: expect.any(String) },
          bestE1rm: { value: 128.33, weight: 110, reps: 5, date: '2026-09-09', entryId: expect.any(String) },
        },
      },
    });
  });

  it('dates a record by the first time it was reached', async () => {
    await log([entry('2026-09-01', 'Bench Press', [set(3, 100)])]);
    await log([entry('2026-09-15', 'Bench Press', [set(3, 100)])]);
    const res = await getRecords({ exerciseName: 'Bench Press' });
    expect(res.body.data.records.maxWeight.date).toBe('2026-09-01');
  });

  it('reports the first set when two sets tie exactly on e1RM', async () => {
    // 70 × (1 + 20/30) and 100 × (1 + 5/30) are both exactly 116.67 kg.
    await log([entry('2026-09-01', 'Bench Press', [set(20, 70), set(5, 100)])]);
    const res = await getRecords({ exerciseName: 'Bench Press' });
    expect(res.body.data.records.bestE1rm).toMatchObject({ value: 116.67, reps: 20, weight: 70 });
  });

  it('compares weights across units by their kilogram value', async () => {
    await log([entry('2026-09-01', 'Deadlift', [set(1, 200, 'lb')])]); // 90.72 kg
    await log([entry('2026-09-02', 'Deadlift', [set(1, 100, 'kg')])]); // heavier, although 100 < 200
    const kg = await getRecords({ exerciseName: 'Deadlift' });
    expect(kg.body.data.records.maxWeight).toMatchObject({ value: 100, date: '2026-09-02' });
    const lb = await getRecords({ exerciseName: 'Deadlift', unit: 'lb' });
    expect(lb.body.data).toMatchObject({ unit: 'lb', records: { maxWeight: { value: 220.46, weight: 220.46 } } });
  });

  it('keeps a weight exact in the unit it was logged in', async () => {
    await log([entry('2026-09-01', 'Bench Press', [set(1, 100.125)])]);
    const res = await getRecords({ exerciseName: 'Bench Press' });
    expect(res.body.data.records.maxWeight).toMatchObject({ value: 100.125, weight: 100.125 });
  });

  it('limits records to an inclusive date range', async () => {
    await log([entry('2026-08-31', 'Bench Press', [set(1, 130)])]);
    await log([entry('2026-09-01', 'Bench Press', [set(1, 110)])]);
    await log([entry('2026-09-30', 'Bench Press', [set(1, 115)])]);
    await log([entry('2026-10-01', 'Bench Press', [set(1, 140)])]);
    const res = await getRecords({ exerciseName: 'Bench Press', from: '2026-09-01', to: '2026-09-30' });
    expect(res.body.data).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      records: { maxWeight: { value: 115, date: '2026-09-30' } },
    });
  });

  it("only uses the requested user's entries", async () => {
    await log([entry('2026-09-01', 'Deadlift', [set(1, 250)])], USER_B);
    await log([entry('2026-09-01', 'Deadlift', [set(1, 180)])]);
    const res = await getRecords({ exerciseName: 'Deadlift' });
    expect(res.body.data.records.maxWeight.value).toBe(180);
  });

  it('returns empty records with a message when there is no data', async () => {
    const res = await getRecords({ exerciseName: 'Deadlift', from: '2026-01-01', to: '2026-01-31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        exerciseName: 'Deadlift',
        unit: 'kg',
        from: '2026-01-01',
        to: '2026-01-31',
        records: { maxWeight: null, maxVolume: null, bestE1rm: null },
      },
      message: 'No Deadlift entries found for this user in the given date range.',
    });
  });

  const invalidQueries: InvalidQueryCase[] = [
    { name: 'a missing exercise name', query: {}, field: 'exerciseName', message: 'exerciseName is required' },
    {
      name: 'an unknown exercise',
      query: { exerciseName: 'Benchpress' },
      field: 'exerciseName',
      message: 'Unknown exercise "Benchpress". GET /exercises lists the valid names',
    },
    {
      name: 'a reversed range',
      query: { exerciseName: 'Bench Press', from: '2026-10-02', to: '2026-10-01' },
      field: 'from',
      message: 'from must be on or before to',
    },
    {
      name: 'an unsupported unit',
      query: { exerciseName: 'Bench Press', unit: 'stone' },
      field: 'unit',
      message: 'Unsupported unit "stone". Supported units: kg, lb',
    },
  ];

  it.each(invalidQueries)('rejects $name', async ({ query, field, message }) => {
    const res = await getRecords(query);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field, message }]);
  });
});
