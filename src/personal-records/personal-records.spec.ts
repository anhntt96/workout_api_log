import type { WeightUnit } from '../domain/weight-units.js';
import { type PrMetric, type RecordRow, hasAnyRecord, presentRecords, toPersonalRecords } from './personal-records.js';

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
    const rows = [row('maxWeight', 1, '140.000'), row('maxVolume', 10, '100.000'), row('bestE1rm', 5, '130.000')];
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
    expect(presentRecords(toPersonalRecords([row('maxWeight', 1, '100.125')], 'kg')).maxWeight).toMatchObject({
      value: 100.125,
      weight: 100.125,
    });
    expect(presentRecords(toPersonalRecords([row('maxWeight', 1, '100.125')], 'lb')).maxWeight).toMatchObject({
      value: 220.74,
      weight: 220.74,
    });
  });

  it('leaves metrics without data as null', () => {
    const records = toPersonalRecords([], 'kg');
    expect(records).toEqual({ maxWeight: null, maxVolume: null, bestE1rm: null });
    expect(hasAnyRecord(records)).toBe(false);
  });
});
