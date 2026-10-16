import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import request from 'supertest';
import { ExercisesRepository } from '../src/exercises/exercises.repository.js';
import { buildPersonalRecordsQuery } from '../src/personal-records/personal-records.repository.js';
import { buildHistoryQuery } from '../src/workouts/workout-entries.repository.js';
import { entriesOf } from './helpers/requests.js';
import { createTestApp, resetWorkouts, type TestApp } from './helpers/test-app.js';

const HEAVY_USER = '7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const OTHER_USER = '8e4a2b3c-5d6e-4f7a-9b0c-1d2e3f4a5b6c';
const SEED_SQL = join(import.meta.dirname, '..', 'scripts', 'seed-large-dataset.sql');
/** Server-side execution budget per query. Index-backed queries take about a millisecond here. */
const QUERY_BUDGET_MS = 50;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

interface ExplainOutput {
  Plan: PlanNode;
  'Execution Time': number;
}

async function seed(pool: Pool, userId: string, entries: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT set_config('seed.user_id', $1, false), set_config('seed.entries', $2, false)",
      [userId, String(entries)],
    );
    await client.query(await readFile(SEED_SQL, 'utf8'));
  } finally {
    client.release();
  }
}

async function explain(pool: Pool, query: { text: string; values: unknown[] }): Promise<ExplainOutput> {
  const { rows } = await pool.query<{ 'QUERY PLAN': ExplainOutput[] }>(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`,
    query.values,
  );
  return rows[0]['QUERY PLAN'][0];
}

/** Tables read with a (parallel) sequential scan anywhere in the plan. */
function seqScannedTables(node: PlanNode): string[] {
  const own = node['Node Type'].includes('Seq Scan') && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap((child) => seqScannedTables(child))];
}

/** Every node of the plan tree, depth first. */
function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap((child) => planNodes(child))];
}

/** Plan nodes that read `workout_entries` rows. */
function entryScans(plan: PlanNode): PlanNode[] {
  return planNodes(plan).filter((node) => node['Relation Name'] === 'workout_entries');
}

/** Rows a scan looked at: returned plus filtered out, over all loops. */
function rowsExamined(node: PlanNode): number {
  return (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops'];
}

describe('50,000 entries for one user', () => {
  let t: TestApp;
  let deadliftId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetWorkouts(t.pool);
    await seed(t.pool, HEAVY_USER, 50_000);
    await seed(t.pool, OTHER_USER, 10_000);
    await t.pool.query('ANALYZE workout_entries; ANALYZE workout_sets');
    const { rows } = await t.pool.query<{ id: string }>("SELECT id FROM exercises WHERE name = 'Deadlift'");
    deadliftId = rows[0].id;
  });

  afterAll(async () => {
    await resetWorkouts(t.pool);
    await t.app.close();
  });

  it('has the seeded volume', async () => {
    const { rows } = await t.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM workout_entries WHERE user_id = $1',
      [HEAVY_USER],
    );
    expect(rows[0].count).toBe(50_000);
  });

  it.each([
    { name: 'first', after: undefined },
    {
      name: 'deep',
      after: {
        performedOn: '2019-01-01',
        createdAt: '2019-01-01T00:00:00Z',
        id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      },
    },
  ])(
    'reads the $name history page from workout_entries_history_idx without discarding rows',
    async ({ after }) => {
      const result = await explain(t.pool, buildHistoryQuery({ userId: HEAVY_USER, after, limit: 21 }));
      const scans = entryScans(result.Plan);
      expect(scans.map((scan) => scan['Index Name'])).toEqual(['workout_entries_history_idx']);
      expect(scans[0]['Rows Removed by Filter'] ?? 0).toBe(0);
      expect(rowsExamined(scans[0])).toBeLessThanOrEqual(21);
      expect(seqScannedTables(result.Plan)).not.toContain('workout_sets');
      expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
    },
  );

  it("reads filtered history from an index, examining a small share of the user's entries", async () => {
    const squats = await t.app.get(ExercisesRepository).findIds({ nameContains: 'squat' });
    const result = await explain(
      t.pool,
      buildHistoryQuery({
        userId: HEAVY_USER,
        exerciseIds: squats,
        from: '2025-01-01',
        to: '2025-12-31',
        limit: 21,
      }),
    );
    expect(seqScannedTables(result.Plan)).not.toContain('workout_entries');
    expect(seqScannedTables(result.Plan)).not.toContain('workout_sets');
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
    const scans = entryScans(result.Plan);
    expect(scans).toHaveLength(1);
    expect(rowsExamined(scans[0])).toBeLessThan(1000);
  });

  it('finds all-time records from the three best_* indexes, examining few rows', async () => {
    const result = await explain(
      t.pool,
      buildPersonalRecordsQuery({ userId: HEAVY_USER, exerciseId: deadliftId }),
    );
    const scans = entryScans(result.Plan);
    expect(scans.map((scan) => scan['Index Name'] ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
      'workout_entries_best_e1rm_idx',
      'workout_entries_best_volume_idx',
      'workout_entries_best_weight_idx',
    ]);
    for (const scan of scans) expect(rowsExamined(scan)).toBeLessThan(1000);
    expect(seqScannedTables(result.Plan)).toEqual([]);
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
  });

  it.each([
    { name: 'ten-year', range: { from: '2016-01-01', to: '2026-12-31' } },
    { name: 'one-month', range: { from: '2026-09-01', to: '2026-09-30' } },
  ])('finds $name records examining few rows', async ({ range }) => {
    const result = await explain(
      t.pool,
      buildPersonalRecordsQuery({ userId: HEAVY_USER, exerciseId: deadliftId, ...range }),
    );
    expect(seqScannedTables(result.Plan)).toEqual([]);
    expect(result['Execution Time']).toBeLessThan(QUERY_BUDGET_MS);
    const scans = entryScans(result.Plan);
    expect(scans).toHaveLength(3);
    for (const scan of scans) expect(rowsExamined(scan)).toBeLessThan(1000);
  });

  it('pages through history over HTTP without repeats', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await request(t.app.getHttpServer())
        .get(`/users/${HEAVY_USER}/workout-entries`)
        .query(cursor === null ? { limit: 100 } : { limit: 100, cursor });
      expect(res.status).toBe(200);
      expect(entriesOf(res)).toHaveLength(100);
      entriesOf(res).forEach((e) => seen.add(e.id));
      cursor = res.body.page.nextCursor;
    }
    expect(seen.size).toBe(500);
  });

  it('returns records and a comparison over HTTP', async () => {
    const server = t.app.getHttpServer();
    const records = await request(server)
      .get(`/users/${HEAVY_USER}/personal-records`)
      .query({ exerciseName: 'Deadlift' });
    expect(records.status).toBe(200);
    expect(records.body.data.records.maxWeight).not.toBeNull();
    const comparison = await request(server).get(`/users/${HEAVY_USER}/personal-records/comparison`).query({
      exerciseName: 'Deadlift',
      from: '2026-09-01',
      to: '2026-09-30',
      baselineFrom: '2025-09-01',
      baselineTo: '2025-09-30',
    });
    expect(comparison.status).toBe(200);
    expect(comparison.body.data.change.maxWeight).not.toBeNull();
  });
});
