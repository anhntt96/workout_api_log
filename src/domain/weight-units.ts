import { Decimal } from 'decimal.js';

/**
 * Supported weight units and the exact number of kilograms in one unit.
 * Adding a unit (for example `st: '6.35029318'`) is a one-line change here: validation,
 * conversion and responses all read this table, and the database stores `unit` as TEXT,
 * so no migration is needed. Never remove a unit that has already been stored.
 */
const KG_PER_UNIT = {
  kg: '1',
  lb: '0.45359237',
} as const;

export type WeightUnit = keyof typeof KG_PER_UNIT;

export const WEIGHT_UNITS = Object.keys(KG_PER_UNIT) as WeightUnit[];

/** Stored weights and metrics keep gram precision. */
export const STORAGE_DECIMALS = 3;
/** Weights and metrics in responses are rounded to two decimals. */
export const DISPLAY_DECIMALS = 2;

export function isWeightUnit(value: string): value is WeightUnit {
  return Object.hasOwn(KG_PER_UNIT, value);
}

/**
 * Converts a weight between units with decimal arithmetic: exact for lb to kg, while the other
 * directions divide at Decimal's 20 significant digits, far below storage or display precision.
 */
export function convertWeight(value: Decimal.Value, from: WeightUnit, to: WeightUnit): Decimal {
  const weight = new Decimal(value);
  if (from === to) return weight;
  return weight.times(KG_PER_UNIT[from]).div(KG_PER_UNIT[to]);
}

export function roundForStorage(value: Decimal): Decimal {
  return value.toDecimalPlaces(STORAGE_DECIMALS, Decimal.ROUND_HALF_UP);
}

export function roundForDisplay(value: Decimal): number {
  return value.toDecimalPlaces(DISPLAY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}
