import type { Decimal } from 'decimal.js';
import { epleyOneRepMax, setVolume } from '../domain/set-metrics.js';
import { type WeightUnit, convertWeight, roundForDisplay } from '../domain/weight-units.js';

export const PR_METRICS = ['maxWeight', 'maxVolume', 'bestE1rm'] as const;
export type PrMetric = (typeof PR_METRICS)[number];

/** The set that holds a record, as stored: its logged weight and unit. */
export interface RecordRow {
  metric: PrMetric;
  entryId: string;
  performedOn: string;
  reps: number;
  weight: string;
  unit: WeightUnit;
}

export interface PersonalRecord {
  /** The metric's value in the requested unit. */
  value: Decimal;
  weight: Decimal;
  reps: number;
  /** The day the record was first reached. */
  date: string;
  entryId: string;
}

export type PersonalRecords = Record<PrMetric, PersonalRecord | null>;

export interface RecordResponse {
  value: number;
  weight: number;
  reps: number;
  date: string;
  entryId: string;
}

export type RecordsResponse = Record<PrMetric, RecordResponse | null>;

export interface PersonalRecordsResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    from: string | null;
    to: string | null;
    records: RecordsResponse;
  };
  /** Present only when there are no records. */
  message?: string;
}

/** Builds each record in the requested unit from the set that holds it. Metrics without data stay null. */
export function toPersonalRecords(rows: readonly RecordRow[], unit: WeightUnit): PersonalRecords {
  const records: PersonalRecords = { maxWeight: null, maxVolume: null, bestE1rm: null };
  for (const row of rows) {
    const weight = convertWeight(row.weight, row.unit, unit);
    records[row.metric] = {
      value: metricValue(row.metric, row.reps, weight),
      weight,
      reps: row.reps,
      date: row.performedOn,
      entryId: row.entryId,
    };
  }
  return records;
}

export function hasAnyRecord(records: PersonalRecords): boolean {
  return PR_METRICS.some((metric) => records[metric] !== null);
}

export function presentRecords(records: PersonalRecords): RecordsResponse {
  const present = (record: PersonalRecord | null): RecordResponse | null =>
    record && {
      value: roundForDisplay(record.value),
      weight: roundForDisplay(record.weight),
      reps: record.reps,
      date: record.date,
      entryId: record.entryId,
    };
  return {
    maxWeight: present(records.maxWeight),
    maxVolume: present(records.maxVolume),
    bestE1rm: present(records.bestE1rm),
  };
}

function metricValue(metric: PrMetric, reps: number, weight: Decimal): Decimal {
  switch (metric) {
    case 'maxWeight':
      return weight;
    case 'maxVolume':
      return setVolume(reps, weight);
    case 'bestE1rm':
      return epleyOneRepMax(reps, weight);
  }
}
