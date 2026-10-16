import { Decimal } from 'decimal.js';
import type { WeightUnit } from '../domain/weight-units.js';
import {
  type PersonalRecords,
  type PrMetric,
  type RecordRow,
  compareRecords,
  hasAnyRecord,
  presentRecords,
  toPersonalRecords,
} from './personal-records.js';

const row = (metric: PrMetric, reps: number, weight: string, unit: WeightUnit = 'kg'): RecordRow => ({
  metric,
  entryId: `entry-${metric}`,
  performedOn: '2026-10-10',
  reps,
  weight,
  unit,
});

describe('toPersonalRecords', () => {
  it('computes each metric from the set that holds it', () => {
    const rows = [
      row('maxWeight', 1, '140.000'),
      row('maxVolume', 10, '100.000'),
      row('bestE1rm', 5, '130.000'),
    ];
    expect(presentRecords(toPersonalRecords(rows, 'kg'))).toEqual({
      maxWeight: { value: 140, weight: 140, reps: 1, date: '2026-10-10', entryId: 'entry-maxWeight' },
      maxVolume: { value: 1000, weight: 100, reps: 10, date: '2026-10-10', entryId: 'entry-maxVolume' },
      bestE1rm: { value: 151.67, weight: 130, reps: 5, date: '2026-10-10', entryId: 'entry-bestE1rm' },
    });
  });

  it('converts from the logged unit and keeps same-unit values exact', () => {
    const rows = [row('maxWeight', 1, '315.000', 'lb')];
    expect(presentRecords(toPersonalRecords(rows, 'lb')).maxWeight?.value).toBe(315);
    expect(presentRecords(toPersonalRecords(rows, 'kg')).maxWeight?.value).toBe(142.88);
    expect(presentRecords(toPersonalRecords([row('maxWeight', 1, '100.125')], 'kg')).maxWeight).toMatchObject(
      {
        value: 100.125,
        weight: 100.125,
      },
    );
    expect(presentRecords(toPersonalRecords([row('maxWeight', 1, '100.125')], 'lb')).maxWeight).toMatchObject(
      {
        value: 220.74,
        weight: 220.74,
      },
    );
  });

  it('leaves metrics without data as null', () => {
    const records = toPersonalRecords([], 'kg');
    expect(records).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(hasAnyRecord(records)).toBe(false);
  });
});

describe('compareRecords', () => {
  const record = (value: number) => ({
    value: new Decimal(value),
    weight: new Decimal(value),
    reps: 1,
    date: '2026-10-01',
    entryId: 'e',
    inLoggedUnit: true,
  });
  const records = (
    maxWeight: number | null,
    maxVolume: number | null = null,
    bestE1rm: number | null = null,
  ): PersonalRecords => ({
    maxWeight: maxWeight === null ? null : record(maxWeight),
    maxVolume: maxVolume === null ? null : record(maxVolume),
    bestE1rm: bestE1rm === null ? null : record(bestE1rm),
  });

  it('reports absolute and percent change per metric', () => {
    expect(compareRecords(records(105, 1000, 120), records(100, 800, 125))).toEqual({
      maxWeight: { absolute: 5, percent: 5 },
      maxVolume: { absolute: 200, percent: 25 },
      bestE1rm: { absolute: -5, percent: -4 },
    });
  });

  it('rounds the percent change to two decimals', () => {
    expect(compareRecords(records(110), records(105)).maxWeight).toEqual({ absolute: 5, percent: 4.76 });
  });

  it('is null for a metric missing in either period', () => {
    expect(compareRecords(records(105), records(null))).toEqual({
      maxWeight: null,
      maxVolume: null,
      bestE1rm: null,
    });
  });

  it('has no percent change from a zero baseline (bodyweight sets)', () => {
    expect(compareRecords(records(10), records(0)).maxWeight).toEqual({ absolute: 10, percent: null });
  });
});
