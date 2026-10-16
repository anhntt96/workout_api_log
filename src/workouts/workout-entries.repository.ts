import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { withTransaction } from '../database/transaction.js';
import type { HistoryCursor } from './history-cursor.js';
import type { NewEntry, StoredSet, WorkoutEntry } from './workout-entry.js';

type Queryable = Pool | PoolClient;

interface EntryRow {
  id: string;
  user_id: string;
  exercise_name: string;
  performed_on: string;
  created_at: string;
  sets: StoredSet[];
}

export interface InsertResult {
  /** Stored entries in request order: new ones, plus earlier ones that share an idempotency key. */
  entries: WorkoutEntry[];
  /** True when at least one entry already existed for its idempotency key. */
  replayed: boolean;
}

/**
 * Completes an inner query that selects `workout_entries` rows (id, user_id, exercise_id,
 * performed_on, created_at, plus any column `orderBy` needs) with the exercise name and the
 * sets. The inner query filters and limits first, so sets load only for the returned entries.
 * `created_at` keeps its microseconds so it can be used in a pagination cursor.
 */
export function selectEntries(innerSql: string, orderBy: string): string {
  return `
    SELECT p.id, p.user_id, x.name::text AS exercise_name, p.performed_on,
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           s.sets
    FROM (${innerSql}) p
    JOIN exercises x ON x.id = p.exercise_id
    CROSS JOIN LATERAL (
      SELECT coalesce(json_agg(json_build_object(
               'reps', ws.reps, 'weight', ws.weight::text, 'unit', ws.unit, 'weightKg', ws.weight_kg::text)
             ORDER BY ws.set_index), '[]') AS sets
      FROM workout_sets ws
      WHERE ws.entry_id = p.id
    ) s
    ORDER BY ${orderBy}`;
}

function toWorkoutEntry(row: EntryRow): WorkoutEntry {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseName: row.exercise_name,
    performedOn: row.performed_on,
    createdAt: row.created_at,
    sets: row.sets,
  };
}

export interface HistoryFilter {
  userId: string;
  /** Only these exercises; undefined means every exercise. */
  exerciseIds?: readonly string[];
  /** Inclusive bounds on performed_on. */
  from?: string;
  to?: string;
  /** Return entries strictly after this position in history order. */
  after?: HistoryCursor;
  limit: number;
}

/**
 * History page, newest first (performed_on DESC, created_at DESC, id DESC; ADR 0002), with
 * keyset pagination. Postgres evaluates the cursor's row comparison inside
 * `workout_entries_history_idx`, so a deep page costs the same as the first one.
 */
export function buildHistoryQuery(filter: HistoryFilter): { text: string; values: unknown[] } {
  const values: unknown[] = [filter.userId];
  const param = (value: unknown, type: string): string => {
    values.push(value);
    return `$${values.length}::${type}`;
  };
  const conditions = ['e.user_id = $1::uuid'];
  if (filter.exerciseIds !== undefined)
    conditions.push(`e.exercise_id = ANY(${param(filter.exerciseIds, 'uuid[]')})`);
  if (filter.from !== undefined) conditions.push(`e.performed_on >= ${param(filter.from, 'date')}`);
  if (filter.to !== undefined) conditions.push(`e.performed_on <= ${param(filter.to, 'date')}`);
  if (filter.after !== undefined) {
    const { performedOn, createdAt, id } = filter.after;
    conditions.push(
      `(e.performed_on, e.created_at, e.id) < (${param(performedOn, 'date')}, ${param(createdAt, 'timestamptz')}, ${param(id, 'uuid')})`,
    );
  }
  const page = `
    SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at
    FROM workout_entries e
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.performed_on DESC, e.created_at DESC, e.id DESC
    LIMIT ${param(filter.limit, 'int')}`;
  return { text: selectEntries(page, 'p.performed_on DESC, p.created_at DESC, p.id DESC'), values };
}

@Injectable()
export class WorkoutEntriesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Inserts entries and their sets in one transaction, so a bulk request is all-or-nothing.
   * An entry whose idempotency key the user already has is skipped (ADR 0003), and the stored
   * entry is returned instead. A parallel retry waits on the unique index until the first
   * request commits, then takes the same path. If the first request rolls back, the retry inserts.
   * This relies on READ COMMITTED (the Postgres default used by withTransaction): under REPEATABLE READ
   * or SERIALIZABLE, a parallel retry would fail with a serialization error instead of replaying.
   */
  async insertEntries(userId: string, entries: readonly NewEntry[]): Promise<InsertResult> {
    return withTransaction(this.pool, async (client) => {
      const insertedIds = await insertEntryRows(client, userId, entries);
      await insertSetRows(
        client,
        entries.filter((entry) => insertedIds.has(entry.id)),
      );
      const keys = entries.map((entry) => entry.idempotencyKey);
      const stored = keys.every((key): key is string => key !== null)
        ? await this.findByIdempotencyKeys(userId, keys, client)
        : await this.findByIds(
            entries.map((entry) => entry.id),
            client,
          );
      return { entries: stored, replayed: insertedIds.size < entries.length };
    });
  }

  /** Entries by id, in the order of `ids`. */
  async findByIds(ids: readonly string[], db: Queryable = this.pool): Promise<WorkoutEntry[]> {
    const { rows } = await db.query<EntryRow>(
      selectEntries(
        `SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at
         FROM workout_entries e
         WHERE e.id = ANY($1::uuid[])`,
        'array_position($1::uuid[], p.id)',
      ),
      [ids],
    );
    return rows.map(toWorkoutEntry);
  }

  /** A user's entries by idempotency key, in the order of `keys`. */
  async findByIdempotencyKeys(
    userId: string,
    keys: readonly string[],
    db: Queryable = this.pool,
  ): Promise<WorkoutEntry[]> {
    const { rows } = await db.query<EntryRow>(
      selectEntries(
        `SELECT e.id, e.user_id, e.exercise_id, e.performed_on, e.created_at, e.idempotency_key
         FROM workout_entries e
         WHERE e.user_id = $1::uuid AND e.idempotency_key = ANY($2::text[])`,
        'array_position($2::text[], p.idempotency_key)',
      ),
      [userId, keys],
    );
    return rows.map(toWorkoutEntry);
  }

  async findHistoryPage(filter: HistoryFilter): Promise<WorkoutEntry[]> {
    const { text, values } = buildHistoryQuery(filter);
    const { rows } = await this.pool.query<EntryRow>(text, values);
    return rows.map(toWorkoutEntry);
  }
}

/** One multi-row INSERT that skips idempotency keys the user already has. Returns the ids inserted. */
async function insertEntryRows(
  client: PoolClient,
  userId: string,
  entries: readonly NewEntry[],
): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO workout_entries
       (id, user_id, exercise_id, performed_on, idempotency_key, best_weight_kg, best_volume_kg, best_e1rm_kg)
     SELECT t.id, $1::uuid, t.exercise_id, t.performed_on, t.idempotency_key,
            t.best_weight_kg, t.best_volume_kg, t.best_e1rm_kg
     FROM unnest($2::uuid[], $3::uuid[], $4::date[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[])
       AS t (id, exercise_id, performed_on, idempotency_key, best_weight_kg, best_volume_kg, best_e1rm_kg)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      userId,
      entries.map((entry) => entry.id),
      entries.map((entry) => entry.exerciseId),
      entries.map((entry) => entry.performedOn),
      entries.map((entry) => entry.idempotencyKey),
      entries.map((entry) => entry.summary.bestWeightKg.toFixed()),
      entries.map((entry) => entry.summary.bestVolumeKg.toFixed()),
      entries.map((entry) => entry.summary.bestE1rmKg.toFixed()),
    ],
  );
  return new Set(rows.map((row) => row.id));
}

/** One multi-row INSERT for every set of the given entries. */
async function insertSetRows(client: PoolClient, entries: readonly NewEntry[]): Promise<void> {
  const rows = entries.flatMap((entry) =>
    entry.sets.map((set, setIndex) => ({ entryId: entry.id, setIndex, ...set })),
  );
  if (rows.length === 0) return;
  await client.query(
    `INSERT INTO workout_sets (entry_id, set_index, reps, weight, unit, weight_kg)
     SELECT * FROM unnest($1::uuid[], $2::smallint[], $3::int[], $4::numeric[], $5::text[], $6::numeric[])`,
    [
      rows.map((row) => row.entryId),
      rows.map((row) => row.setIndex),
      rows.map((row) => row.reps),
      rows.map((row) => row.weight.toFixed()),
      rows.map((row) => row.unit),
      rows.map((row) => row.weightKg.toFixed()),
    ],
  );
}
