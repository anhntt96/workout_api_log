import { escapeLikePattern } from './like-pattern.js';

describe('escapeLikePattern', () => {
  it('escapes the % and _ wildcards', () => {
    expect(escapeLikePattern('100%_done')).toBe('100\\%\\_done');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('Bench Press')).toBe('Bench Press');
  });
});
