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
  /** True when the record set was logged in the requested unit, so its weight is shown exactly. */
  inLoggedUnit: boolean;
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
      inLoggedUnit: row.unit === unit,
    };
  }
  return records;
}

export function hasAnyRecord(records: PersonalRecords): boolean {
  return PR_METRICS.some((metric) => records[metric] !== null);
}

export function presentRecords(records: PersonalRecords): RecordsResponse {
  const present = (metric: PrMetric, record: PersonalRecord | null): RecordResponse | null => {
    if (record === null) return null;
    // A weight shown in the unit it was logged in keeps its exact logged value (global rule).
    const weight = record.inLoggedUnit ? record.weight.toNumber() : roundForDisplay(record.weight);
    return {
      value: metric === 'maxWeight' ? weight : roundForDisplay(record.value),
      weight,
      reps: record.reps,
      date: record.date,
      entryId: record.entryId,
    };
  };
  return {
    maxWeight: present('maxWeight', records.maxWeight),
    maxVolume: present('maxVolume', records.maxVolume),
    bestE1rm: present('bestE1rm', records.bestE1rm),
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

export interface MetricChange {
  /** current − baseline, in the requested unit. */
  absolute: number;
  /** Change relative to the baseline in percent; null when the baseline is zero. */
  percent: number | null;
}

export type RecordChanges = Record<PrMetric, MetricChange | null>;

export interface PeriodRecords {
  from: string;
  to: string;
  records: RecordsResponse;
}

export interface RecordsComparisonResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    current: PeriodRecords;
    baseline: PeriodRecords;
    change: RecordChanges;
  };
  /** Present only when neither period has data. */
  message?: string;
}

/** Per-metric change from the baseline period to the current one; null when either period lacks a record. */
export function compareRecords(current: PersonalRecords, baseline: PersonalRecords): RecordChanges {
  const change = (metric: PrMetric): MetricChange | null => {
    const now = current[metric];
    const before = baseline[metric];
    if (now === null || before === null) return null;
    const difference = now.value.minus(before.value);
    return {
      absolute: roundForDisplay(difference),
      percent: before.value.isZero() ? null : roundForDisplay(difference.div(before.value).times(100)),
    };
  };
  return { maxWeight: change('maxWeight'), maxVolume: change('maxVolume'), bestE1rm: change('bestE1rm') };
}
