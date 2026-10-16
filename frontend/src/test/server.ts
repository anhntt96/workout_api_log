import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CATALOG, NO_RECORDS } from './fixtures';

/**
 * API stand-in for tests: the catalog plus an empty account. Tests replace a handler with
 * `server.use(...)`; a request no handler matches fails the test.
 */
export const server = setupServer(
  http.get('/api/exercises', () => HttpResponse.json({ data: CATALOG })),
  http.get('/api/users/:userId/workout-entries', () =>
    HttpResponse.json({
      data: [],
      page: { limit: 20, nextCursor: null },
      message: 'No workout entries match the given filters.',
    }),
  ),
  http.get('/api/users/:userId/personal-records', ({ request }) => {
    const query = new URL(request.url).searchParams;
    const exerciseName = query.get('exerciseName') ?? '';
    return HttpResponse.json({
      data: { exerciseName, unit: query.get('unit'), from: null, to: null, records: NO_RECORDS },
      message: `No ${exerciseName} entries found for this user.`,
    });
  }),
  http.get('/api/users/:userId/personal-records/comparison', ({ request }) => {
    const query = new URL(request.url).searchParams;
    const exerciseName = query.get('exerciseName') ?? '';
    return HttpResponse.json({
      data: {
        exerciseName,
        unit: query.get('unit'),
        current: { from: query.get('from'), to: query.get('to'), records: NO_RECORDS },
        baseline: { from: query.get('baselineFrom'), to: query.get('baselineTo'), records: NO_RECORDS },
        change: NO_RECORDS,
      },
      message: `No ${exerciseName} entries found for this user in either date range.`,
    });
  }),
);
