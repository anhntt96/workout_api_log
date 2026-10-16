import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Records } from '../../api/types';
import { CATALOG, NO_RECORDS, USER_ID } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

const BENCH_RECORDS: Records = {
  maxWeight: { value: 120, weight: 120, reps: 1, date: '2026-09-02', entryId: 'e1' },
  maxVolume: { value: 800, weight: 80, reps: 10, date: '2026-09-02', entryId: 'e1' },
  bestE1rm: { value: 128.33, weight: 110, reps: 5, date: '2026-09-09', entryId: 'e2' },
};

const SERVER_ERROR = { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };

function serveRecords(records: Records) {
  const requests: URL[] = [];
  server.use(
    http.get('/api/users/:userId/personal-records', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json({
        data: {
          exerciseName: url.searchParams.get('exerciseName'),
          unit: url.searchParams.get('unit'),
          from: null,
          to: null,
          records,
        },
      });
    }),
  );
  return requests;
}

describe('RecordsPage', () => {
  it('shows the three records of the first catalog exercise, with how and when each was set', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    renderApp('/records');

    const heaviest = await screen.findByRole('group', { name: 'Heaviest single set' });
    expect(heaviest).toHaveTextContent('120kg');
    expect(heaviest).toHaveTextContent('1 rep × 120 kg');
    expect(heaviest).toHaveTextContent('Achieved Sep 2, 2026');

    const volume = screen.getByRole('group', { name: 'Highest volume set' });
    expect(volume).toHaveTextContent('800kg');
    expect(volume).toHaveTextContent('10 reps × 80 kg');

    const e1rm = screen.getByRole('group', { name: 'Best estimated 1RM' });
    expect(e1rm).toHaveTextContent('128.33kg');
    expect(e1rm).toHaveTextContent('Epley, from 5 reps × 110 kg');
    expect(e1rm).toHaveTextContent('Achieved Sep 9, 2026');

    expect(screen.getByLabelText('Exercise')).toHaveValue('Back Squat');
    expect(requests[0]?.pathname).toBe(`/api/users/${USER_ID}/personal-records`);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Back Squat',
      unit: 'kg',
    });
  });

  it('switches exercise from the picker', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    const { user } = renderApp('/records');
    await screen.findByRole('group', { name: 'Heaviest single set' });

    await user.selectOptions(screen.getByLabelText('Exercise'), 'Deadlift');

    await waitFor(() => expect(requests.at(-1)?.searchParams.get('exerciseName')).toBe('Deadlift'));
    expect(screen.getByLabelText('Exercise')).toHaveValue('Deadlift');
  });

  it('reads the exercise from the URL and requests the display unit', async () => {
    const requests = serveRecords(BENCH_RECORDS);
    renderApp('/records?exercise=Bench%20Press', { unit: 'lb' });

    expect(await screen.findByRole('group', { name: 'Heaviest single set' })).toHaveTextContent('120lb');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Bench Press',
      unit: 'lb',
    });
  });

  it('explains when there are no records yet and offers sample data', async () => {
    renderApp('/records?exercise=Deadlift');

    expect(await screen.findByText('No Deadlift entries found for this user.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load sample data' })).toBeInTheDocument();
    for (const name of ['Heaviest single set', 'Highest volume set', 'Best estimated 1RM']) {
      expect(screen.getByRole('group', { name })).toHaveTextContent('No sets logged yet');
    }
  });

  it('shows a record of bodyweight work without a weight', async () => {
    serveRecords({
      ...NO_RECORDS,
      maxVolume: { value: 0, weight: 0, reps: 12, date: '2026-10-01', entryId: 'e3' },
    });
    renderApp('/records?exercise=Pull-Up');

    expect(await screen.findByRole('group', { name: 'Highest volume set' })).toHaveTextContent(
      '12 reps at bodyweight',
    );
  });

  it('shows the API error for an exercise outside the catalog', async () => {
    server.use(
      http.get('/api/users/:userId/personal-records', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            errors: [{ field: 'exerciseName', message: 'Unknown exercise "Curl"' }],
          },
          { status: 400 },
        ),
      ),
    );
    renderApp('/records?exercise=Curl');

    expect(await screen.findByRole('alert')).toHaveTextContent('exerciseName: Unknown exercise "Curl"');
    expect(screen.queryByRole('group', { name: 'Heaviest single set' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Compare periods' })).not.toBeInTheDocument();
  });

  it('offers Try again when the records fail to load', async () => {
    let fail = true;
    server.use(
      http.get('/api/users/:userId/personal-records', ({ request }) =>
        fail
          ? HttpResponse.json(SERVER_ERROR, { status: 500 })
          : HttpResponse.json({
              data: {
                exerciseName: new URL(request.url).searchParams.get('exerciseName'),
                unit: 'kg',
                from: null,
                to: null,
                records: BENCH_RECORDS,
              },
            }),
      ),
    );
    const { user } = renderApp('/records');

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('group', { name: 'Heaviest single set' })).toHaveTextContent('120kg');
  });

  it('offers Try again when the exercise catalog fails, instead of loading forever', async () => {
    let fail = true;
    server.use(
      http.get('/api/exercises', () =>
        fail ? HttpResponse.json(SERVER_ERROR, { status: 500 }) : HttpResponse.json({ data: CATALOG }),
      ),
    );
    serveRecords(BENCH_RECORDS);
    const { user, container } = renderApp('/records');

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(container.querySelector('[class*="animate-pulse"]')).toBeNull();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('group', { name: 'Heaviest single set' })).toBeInTheDocument();
    expect(screen.getByLabelText('Exercise')).toHaveValue('Back Squat');
  });
});
