import { decodeCursor, encodeCursor } from './history-cursor.js';

const cursor = {
  performedOn: '2026-10-14',
  createdAt: '2026-10-15T09:09:08.404114Z',
  id: '86576499-296e-4c44-bb4e-57e950b9eb57',
};

describe('history cursor', () => {
  it('round-trips, keeping microseconds', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is URL-safe', () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    '',
    'not-base64!',
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('["2026-10-14","yesterday","x"]').toString('base64url'),
    Buffer.from('["0000-01-01","0000-01-01T00:00:00Z","86576499-296e-4c44-bb4e-57e950b9eb57"]').toString(
      'base64url',
    ),
  ])('rejects %j', (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
