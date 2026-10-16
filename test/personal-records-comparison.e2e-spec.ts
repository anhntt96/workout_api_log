import request from 'supertest';
import { entry, logOk, set } from './helpers/requests.js';
import { USER_A, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const OCTOBER_VS_SEPTEMBER = {
  from: '2026-10-01',
  to: '2026-10-31',
  baselineFrom: '2026-09-01',
  baselineTo: '2026-09-30',
};

describe('GET /users/:userId/personal-records/comparison', () => {
  let t: TestApp;

  const compare = (query: Record<string, string>) =>
    request(t.app.getHttpServer()).get(`/users/${USER_A}/personal-records/comparison`).query(query);
  const log = (entries: unknown[]) => logOk(t.app, USER_A, entries);

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await resetWorkouts(t.pool);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('compares this month with last month', async () => {
    await log([entry('2026-09-05', 'Bench Press', [set(5, 100)])]); // baseline best volume 500, e1RM 116.67
    await log([entry('2026-09-20', 'Bench Press', [set(1, 105)])]); // baseline heaviest 105
    await log([entry('2026-10-03', 'Bench Press', [set(3, 110)])]); // current: 110, volume 330, e1RM 121
    const res = await compare({ exerciseName: 'Bench Press', ...OCTOBER_VS_SEPTEMBER });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      exerciseName: 'Bench Press',
      unit: 'kg',
      current: {
        from: '2026-10-01',
        to: '2026-10-31',
        records: { maxWeight: { value: 110, date: '2026-10-03' } },
      },
      baseline: {
        from: '2026-09-01',
        to: '2026-09-30',
        records: { maxWeight: { value: 105, date: '2026-09-20' } },
      },
      change: {
        maxWeight: { absolute: 5, percent: 4.76 },
        maxVolume: { absolute: -170, percent: -34 },
        bestE1rm: { absolute: 4.33, percent: 3.71 },
      },
    });
    expect(res.body).not.toHaveProperty('message');
  });

  it('reports null changes when one period has no data', async () => {
    await log([entry('2026-10-03', 'Bench Press', [set(3, 110)])]);
    const res = await compare({ exerciseName: 'Bench Press', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.baseline.records).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(res.body.data.change).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(res.body).not.toHaveProperty('message');
  });

  it('returns a message when neither period has data', async () => {
    const res = await compare({ exerciseName: 'Deadlift', ...OCTOBER_VS_SEPTEMBER });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No Deadlift entries found for this user in either date range.');
  });

  it('has no percent change from a zero-weight baseline', async () => {
    await log([entry('2026-09-10', 'Pull-Up', [set(10, 0)])]);
    await log([entry('2026-10-10', 'Pull-Up', [set(8, 10)])]);
    const res = await compare({ exerciseName: 'Pull-Up', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.change.maxWeight).toEqual({ absolute: 10, percent: null });
  });

  it('converts both periods to the requested unit', async () => {
    await log([entry('2026-09-05', 'Deadlift', [set(1, 100)])]);
    await log([entry('2026-10-05', 'Deadlift', [set(1, 225, 'lb')])]);
    const res = await compare({ exerciseName: 'Deadlift', unit: 'lb', ...OCTOBER_VS_SEPTEMBER });
    expect(res.body.data.current.records.maxWeight.value).toBe(225);
    expect(res.body.data.baseline.records.maxWeight.value).toBe(220.46);
    expect(res.body.data.change.maxWeight).toEqual({ absolute: 4.54, percent: 2.06 });
  });

  it('requires both periods and reports every reversed range', async () => {
    const missing = await compare({
      exerciseName: 'Bench Press',
      from: '2026-10-01',
      to: '2026-10-31',
      baselineFrom: '2026-09-01',
    });
    expect(missing.status).toBe(400);
    expect(missing.body.errors).toEqual([{ field: 'baselineTo', message: 'baselineTo is required' }]);

    const reversed = await compare({
      exerciseName: 'Bench Press',
      from: '2026-10-31',
      to: '2026-10-01',
      baselineFrom: '2026-09-30',
      baselineTo: '2026-09-01',
    });
    expect(reversed.status).toBe(400);
    expect(reversed.body.errors).toEqual([
      { field: 'from', message: 'from must be on or before to' },
      { field: 'baselineFrom', message: 'baselineFrom must be on or before baselineTo' },
    ]);
  });
});
