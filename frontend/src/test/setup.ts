import '@testing-library/jest-dom/vitest';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  // Every test runs on Friday 2026-10-16 at 00:30 local time, when the UTC day (in this UTC+7 zone) is still
  // 2026-10-15, so a screen that uses the UTC day fails. Only Date is faked; timers stay real for user-event and MSW.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 0, 30) });
});

afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => server.close());
