import '@testing-library/jest-dom/vitest';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  // Every test runs on Friday 2026-10-16 at local noon. Only Date is faked; timers stay real for user-event and MSW.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 12) });
});

afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => server.close());
