import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { summarizeSets } from '../src/domain/set-metrics.js';
import { WorkoutEntriesRepository } from '../src/workouts/workout-entries.repository.js';
import type { NewEntry } from '../src/workouts/workout-entry.js';
import { countEntries, entriesOf, entry, logEntries, set } from './helpers/requests.js';
import { USER_A, USER_B, createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const benchPress = (weight: number) => entry('2026-10-14', 'Bench Press', [set(5, weight)]);

function newEntry(exerciseId: string, idempotencyKey: string, reps: number): NewEntry {
  const weight = new Decimal(100);
  return {
    id: randomUUID(),
    exerciseId,
    performedOn: '2026-10-14',
    idempotencyKey,
    summary: summarizeSets([{ reps, weightKg: weight }]),
    sets: [{ reps, weight, unit: 'kg', weightKg: weight }],
  };
}

describe('idempotent and concurrent logging', () => {
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

  it('stores a retried request once and returns the original entries', async () => {
    const entries = [benchPress(100), entry('2026-10-14', 'Barbell Row', [set(8, 60)])];
    const first = await logEntries(t.app, USER_A, entries, 'req-1');
    const retry = await logEntries(t.app, USER_A, entries, 'req-1');
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await countEntries(t.pool)).toBe(2);
  });

  it('stores parallel identical requests once', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => logEntries(t.app, USER_A, [benchPress(100)], 'parallel-1')),
    );
    expect(responses.map((res) => res.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map((res) => entriesOf(res)[0].id)).size).toBe(1);
    expect(responses.filter((res) => res.headers['idempotent-replayed'] === 'true')).toHaveLength(7);
    expect(await countEntries(t.pool)).toBe(1);
  });

  it('keeps every concurrent log of the same exercise on the same day without keys or with different keys', async () => {
    const withoutKeys = Array.from({ length: 5 }, () => logEntries(t.app, USER_A, [benchPress(100)]));
    const withKeys = Array.from({ length: 5 }, (_, i) =>
      logEntries(t.app, USER_A, [benchPress(100)], `distinct-${i}`),
    );
    const responses = await Promise.all([...withoutKeys, ...withKeys]);
    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(await countEntries(t.pool)).toBe(10);
  });

  it('scopes keys to the user', async () => {
    await logEntries(t.app, USER_A, [benchPress(100)], 'shared-key');
    const other = await logEntries(t.app, USER_B, [benchPress(80)], 'shared-key');
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(entriesOf(other)[0]).toMatchObject({
      userId: USER_B,
      sets: [{ reps: 5, weight: 80, unit: 'kg' }],
    });
    expect(await countEntries(t.pool)).toBe(2);
  });

  it('returns the original entries when a key is reused with a different body (documented ADR 0003 limitation)', async () => {
    const first = await logEntries(t.app, USER_A, [benchPress(100)], 'reused');
    const second = await logEntries(t.app, USER_A, [benchPress(120)], 'reused');
    expect(entriesOf(second)).toEqual(entriesOf(first));
    expect(await countEntries(t.pool)).toBe(1);
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const res = await logEntries(t.app, USER_A, [benchPress(100)], 'has spaces');
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: 'Idempotency-Key', message: expect.any(String) }]);
    expect(await countEntries(t.pool)).toBe(0);
  });

  it('stores nothing when a write fails part-way, and the same key can then be retried', async () => {
    const repository = t.app.get(WorkoutEntriesRepository);
    const { rows } = await t.pool.query<{ id: string }>("SELECT id FROM exercises WHERE name = 'Deadlift'");
    const good = newEntry(rows[0].id, 'atomic#0', 5);
    const bad = newEntry(rows[0].id, 'atomic#1', 0); // reps = 0 violates CHECK (reps > 0) on the second entry
    await expect(repository.insertEntries(USER_A, [good, bad])).rejects.toMatchObject({ code: '23514' });
    expect(await countEntries(t.pool)).toBe(0);

    const retry = await repository.insertEntries(USER_A, [good, newEntry(rows[0].id, 'atomic#1', 5)]);
    expect(retry.replayed).toBe(false);
    expect(retry.entries).toHaveLength(2);
  });
});
