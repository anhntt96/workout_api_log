import { Decimal } from 'decimal.js';
import { WEIGHT_UNITS, convertWeight, isWeightUnit, roundForDisplay, roundForStorage } from './weight-units.js';

describe('weight units', () => {
  it('lists the supported units', () => {
    expect(WEIGHT_UNITS).toEqual(['kg', 'lb']);
  });

  it.each(['kg', 'lb'])('accepts %s', (unit) => {
    expect(isWeightUnit(unit)).toBe(true);
  });

  // 'toString' and '__proto__' catch a lookup that walks the prototype chain.
  it.each(['KG', 'stone', '', 'toString', '__proto__'])('rejects %j', (unit) => {
    expect(isWeightUnit(unit)).toBe(false);
  });

  it('converts pounds to kilograms with the exact factor', () => {
    expect(convertWeight(100, 'lb', 'kg').toString()).toBe('45.359237');
  });

  it('converts kilograms to pounds', () => {
    expect(roundForDisplay(convertWeight(100, 'kg', 'lb'))).toBe(220.46);
  });

  it('returns the value unchanged for the same unit', () => {
    expect(convertWeight('102.125', 'lb', 'lb').toString()).toBe('102.125');
  });

  it('rounds half up: 3 decimals for storage, 2 for display', () => {
    expect(roundForStorage(new Decimal('45.3595')).toFixed(3)).toBe('45.360');
    expect(roundForStorage(new Decimal('45.3594')).toFixed(3)).toBe('45.359');
    // Float arithmetic would give 1.00 here; exact decimals give 1.01.
    expect(roundForDisplay(new Decimal('1.005'))).toBe(1.01);
  });
});
