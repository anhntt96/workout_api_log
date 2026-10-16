import { hideRandomUuid } from '../test/fixtures';
import { isUuid, newUuid, shortId } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

describe('newUuid', () => {
  it('returns a random v4 UUID', () => {
    expect(newUuid()).toMatch(V4);
    expect(newUuid()).not.toBe(newUuid());
  });

  it('works where crypto.randomUUID is missing (plain-http origins such as a LAN address)', () => {
    const restore = hideRandomUuid();
    try {
      const ids = Array.from({ length: 50 }, () => newUuid());
      for (const id of ids) expect(id).toMatch(V4);
      expect(new Set(ids).size).toBe(50);
    } finally {
      restore();
    }
    expect(typeof crypto.randomUUID).toBe('function');
  });
});
