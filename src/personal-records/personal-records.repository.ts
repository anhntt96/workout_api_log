import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import type { WeightUnit } from '../domain/weight-units.js';
import { PR_METRICS, type PrMetric, type RecordRow } from './personal-records.js';

export interface RecordQuery {
  userId: string;
  exerciseId: string;
  /** Inclusive bounds on performed_on; omitted means unbounded. */
  from?: string;
  to?: string;
}

/**
 * Per metric: the entry summary column that ranks entries, and the order that picks the
 * record set inside the winning entry. Constant SQL fragments only, never user input.
 */
const METRIC_SQL: Record<PrMetric, { column: string; setOrder: string }> = {
  maxWeight: { column: 'best_weight_kg', setOrder: 'ws.weight_kg DESC, ws.reps DESC, ws.set_index' },
  maxVolume: {
    column: 'best_volume_kg',
    setOrder: 'ws.reps * ws.weight_kg DESC, ws.weight_kg DESC, ws.set_index',
  },
  bestE1rm: { column: 'best_e1rm_kg', setOrder: 'ws.weight_kg * (ws.reps + 30) DESC, ws.set_index' },
};

/**
 * One round trip, three index lookups. For each metric it finds the user's best entry for the
 * exercise (the earliest on ties, so the date is when the record was first reached), then the
 * set in that entry that produced it. All-time lookups read the first row of the matching best_*
 * index (ADR 0001). Ranged lookups let the planner choose between that index and
 * `workout_entries_exercise_date_idx`, and the 50k test bounds the rows either plan reads.
 */
export function buildPersonalRecordsQuery(query: RecordQuery): { text: string; values: unknown[] } {
  const values: unknown[] = [query.userId, query.exerciseId];
  const conditions = ['e.user_id = $1::uuid', 'e.exercise_id = $2::uuid'];
  if (query.from !== undefined) {
    values.push(query.from);
    conditions.push(`e.performed_on >= $${values.length}::date`);
  }
  if (query.to !== undefined) {
    values.push(query.to);
    conditions.push(`e.performed_on <= $${values.length}::date`);
  }
  const where = conditions.join(' AND ');
  const perMetric = PR_METRICS.map((metric) => {
    const { column, setOrder } = METRIC_SQL[metric];
    return `(
      SELECT '${metric}' AS metric, best.id AS entry_id, best.performed_on, ws.reps, ws.weight::text AS weight, ws.unit
      FROM (
        SELECT e.id, e.performed_on
        FROM workout_entries e
        WHERE ${where}
        ORDER BY e.${column} DESC, e.performed_on, e.created_at, e.id
        LIMIT 1
      ) best
      CROSS JOIN LATERAL (
        SELECT ws.reps, ws.weight, ws.unit
        FROM workout_sets ws
        WHERE ws.entry_id = best.id
        ORDER BY ${setOrder}
        LIMIT 1
      ) ws
    )`;
  });
  return { text: perMetric.join('\nUNION ALL\n'), values };
}

interface RecordDbRow {
  metric: PrMetric;
  entry_id: string;
  performed_on: string;
  reps: number;
  weight: string;
  unit: WeightUnit;
}

@Injectable()
export class PersonalRecordsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The set holding each record; a metric without data has no row. */
  async findRecordRows(query: RecordQuery): Promise<RecordRow[]> {
    const { text, values } = buildPersonalRecordsQuery(query);
    const { rows } = await this.pool.query<RecordDbRow>(text, values);
    return rows.map((row) => ({
      metric: row.metric,
      entryId: row.entry_id,
      performedOn: row.performed_on,
      reps: row.reps,
      weight: row.weight,
      unit: row.unit,
    }));
  }
}
