import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { ApiError, apiRequest } from './client';
import { getHistory, logWorkouts } from './endpoints';

describe('apiRequest', () => {
  it('sends the query without empty values and returns the JSON body', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/things', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );

    const { body } = await apiRequest<{ ok: boolean }>('/things', {
      query: { a: '1', b: '', c: undefined, d: 'x y' },
    });

    expect(body).toEqual({ ok: true });
    expect(url?.search).toBe('?a=1&d=x+y');
  });

  it('turns the API error format into an ApiError with field errors and request id', async () => {
    server.use(
      http.get('/api/things', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            errors: [{ field: 'from', message: 'from must be on or before to' }],
            requestId: 'req-1',
          },
          { status: 400 },
        ),
      ),
    );

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      errors: [{ field: 'from', message: 'from must be on or before to' }],
      requestId: 'req-1',
      isClientError: true,
    });
  });

  it('describes a non-JSON error response, such as a proxy 502', async () => {
    server.use(
      http.get(
        '/api/things',
        () => new HttpResponse('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      ),
    );

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'The API responded with 502 Bad Gateway',
      isClientError: false,
    });
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    server.use(http.get('/api/things', () => HttpResponse.error()));

    const error = await apiRequest('/things').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

describe('endpoints', () => {
  it('requests a history page with filters, unit, cursor and page size', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/users/:userId/workout-entries', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ data: [], page: { limit: 20, nextCursor: null } });
      }),
    );

    await getHistory('u-1', { exerciseName: 'squat', muscleGroup: undefined, unit: 'lb', cursor: 'c1' });

    expect(url?.pathname).toBe('/api/users/u-1/workout-entries');
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      exerciseName: 'squat',
      unit: 'lb',
      cursor: 'c1',
      limit: '20',
    });
  });

  it('posts entries with the Idempotency-Key and reports a replay', async () => {
    let request: Request | undefined;
    server.use(
      http.post('/api/users/:userId/workout-entries', ({ request: received }) => {
        request = received.clone();
        return HttpResponse.json({ data: [] }, { status: 201, headers: { 'Idempotent-Replayed': 'true' } });
      }),
    );
    const entries = [
      { date: '2026-10-16', exerciseName: 'Deadlift', sets: [{ reps: 5, weight: 140, unit: 'kg' as const }] },
    ];

    const result = await logWorkouts('u-1', entries, 'key-1');

    expect(result).toEqual({ entries: [], replayed: true });
    expect(request?.headers.get('Idempotency-Key')).toBe('key-1');
    expect(request?.headers.get('Content-Type')).toBe('application/json');
    expect(await request?.json()).toEqual({ entries });
  });
});
