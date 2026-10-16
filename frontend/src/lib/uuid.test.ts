import { isUuid, shortId } from './uuid';

describe('isUuid', () => {
  it.each([
    '0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e',
    '0B7E5F0E-8A39-4C1E-9D5A-2F1C3B4A5D6E',
    '00000000-0000-0000-0000-000000000000',
    '  0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e  ',
  ])('accepts %j', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '0b7e5f0e-8a39-4c1e-9d5a',
    '0b7e5f0e8a394c1e9d5a2f1c3b4a5d6e',
    '{0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e}',
    'zb7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e',
  ])('rejects %j', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('shortId', () => {
  it('keeps the first 8 and last 4 characters', () => {
    expect(shortId('0b7e5f0e-8a39-4c1e-9d5a-2f1c3b4a5d6e')).toBe('0b7e5f0e…5d6e');
  });
});
