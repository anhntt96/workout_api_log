import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { HistoryPage } from '../../api/types';
import { USER_ID, makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

/** Serves `pages` in order (the cursor of page n is `c<n>`) and records every request URL. */
function serveHistory(...pages: HistoryPage['data'][]) {
  const requests: URL[] = [];
  server.use(
    http.get('/api/users/:userId/workout-entries', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const index = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')!.slice(1)) : 0;
      const data = pages[index] ?? [];
      return HttpResponse.json({
        data,
        page: { limit: 20, nextCursor: index + 1 < pages.length ? `c${index + 1}` : null },
        ...(data.length === 0 ? { message: 'No workout entries match the given filters.' } : {}),
      });
    }),
  );
  return requests;
}

describe('HistoryPage', () => {
  it('lists entries grouped by day with their sets, stats and muscle groups', async () => {
    const requests = serveHistory([
      makeEntry({
        date: '2026-10-16',
        exerciseName: 'Bench Press',
        sets: [
          { reps: 5, weight: 100, unit: 'kg' },
          { reps: 3, weight: 105, unit: 'kg' },
        ],
      }),
      makeEntry({ date: '2026-10-14', exerciseName: 'Pull-Up', sets: [{ reps: 10, weight: 0, unit: 'kg' }] }),
    ]);
    renderApp('/history');

    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
    expect(within(today).getByText('5 × 100 kg')).toBeInTheDocument();
    expect(within(today).getByText('3 × 105 kg')).toBeInTheDocument();
    expect(within(today).getByText('815 kg')).toBeInTheDocument();
    expect(within(today).getByText('chest')).toBeInTheDocument();

    const earlier = screen.getByRole('region', { name: 'Wed, Oct 14' });
    expect(within(earlier).getByText('10 × BW')).toBeInTheDocument();
    expect(screen.getByText("That's every entry.")).toBeInTheDocument();

    expect(requests[0]?.pathname).toBe(`/api/users/${USER_ID}/workout-entries`);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({ unit: 'kg', limit: '20' });
  });

  it('requests weights in the display unit', async () => {
    const requests = serveHistory([makeEntry({ sets: [{ reps: 5, weight: 220.46, unit: 'lb' }] })]);
    renderApp('/history', { unit: 'lb' });

    expect(await screen.findByText('5 × 220.46 lb')).toBeInTheDocument();
    expect(requests[0]?.searchParams.get('unit')).toBe('lb');
  });

  it('searches by exercise after typing pauses and keeps the filter in the URL', async () => {
    const requests = serveHistory([makeEntry()]);
    const { user } = renderApp('/history');
    await screen.findByText('5 × 100 kg');

    await user.type(screen.getByLabelText('Exercise'), 'squat');

    await waitFor(() => expect(requests.at(-1)?.searchParams.get('exerciseName')).toBe('squat'));
    // Debounced: no request for the partial words typed on the way.
    expect(requests.map((url) => url.searchParams.get('exerciseName'))).toEqual([null, 'squat']);
  });

  it('applies filters from the URL on load', async () => {
    const requests = serveHistory([makeEntry()]);
    renderApp('/history?exercise=bench&muscle=chest&from=2026-10-01&to=2026-10-15');

    await screen.findByText('5 × 100 kg');
    expect(screen.getByLabelText('Exercise')).toHaveValue('bench');
    expect(screen.getByLabelText('Muscle group')).toHaveValue('chest');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'bench',
      muscleGroup: 'chest',
      from: '2026-10-01',
      to: '2026-10-15',
      unit: 'kg',
      limit: '20',
    });
  });

  it('filters by muscle group and date range', async () => {
    const requests = serveHistory([makeEntry()]);
    const { user } = renderApp('/history');
    await screen.findByText('5 × 100 kg');

    await user.selectOptions(screen.getByLabelText('Muscle group'), 'glutes');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });

    await waitFor(() =>
      expect(Object.fromEntries(requests.at(-1)?.searchParams ?? [])).toEqual({
        muscleGroup: 'glutes',
        from: '2026-09-01',
        to: '2026-09-30',
        unit: 'kg',
        limit: '20',
      }),
    );
  });

  it('flags a date range that ends before it starts, without asking the API', async () => {
    const requests = serveHistory([makeEntry()]);
    renderApp('/history?from=2026-10-10&to=2026-10-01');

    expect(await screen.findByText('From must be on or before To')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('loads the next page with the cursor', async () => {
    const requests = serveHistory(
      [makeEntry({ exerciseName: 'Bench Press' })],
      [makeEntry({ exerciseName: 'Deadlift', date: '2026-10-01' })],
    );
    const { user } = renderApp('/history');
    await screen.findByRole('heading', { name: 'Bench Press' });

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('heading', { name: 'Deadlift' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bench Press' })).toBeInTheDocument();
    expect(requests[1]?.searchParams.get('cursor')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows the API message and a way out when filters match nothing', async () => {
    serveHistory([]);
    const { user } = renderApp('/history?exercise=curl');

    expect(await screen.findByText('No workout entries match the given filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('heading', { name: 'No workouts yet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Exercise')).toHaveValue('');
  });

  it('shows API errors with field details and the request id, and can retry', async () => {
    let fail = true;
    server.use(
      http.get('/api/users/:userId/workout-entries', () =>
        fail
          ? HttpResponse.json(
              {
                statusCode: 400,
                code: 'VALIDATION_ERROR',
                message: 'Request validation failed',
                errors: [{ field: 'muscleGroup', message: 'Unknown muscle group "neck"' }],
                requestId: 'req-42',
              },
              { status: 400 },
            )
          : HttpResponse.json({ data: [makeEntry()], page: { limit: 20, nextCursor: null } }),
      ),
    );
    const { user } = renderApp('/history?muscle=neck');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Request validation failed');
    expect(alert).toHaveTextContent('muscleGroup: Unknown muscle group "neck"');
    expect(alert).toHaveTextContent('Request ID req-42');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('5 × 100 kg')).toBeInTheDocument();
  });
});
