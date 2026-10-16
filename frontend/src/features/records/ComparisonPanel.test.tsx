import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

describe('ComparisonPanel', () => {
  function serveComparison() {
    const requests: URL[] = [];
    server.use(
      http.get('/api/users/:userId/personal-records/comparison', ({ request }) => {
        const url = new URL(request.url);
        requests.push(url);
        const q = url.searchParams;
        return HttpResponse.json({
          data: {
            exerciseName: q.get('exerciseName'),
            unit: q.get('unit'),
            current: {
              from: q.get('from'),
              to: q.get('to'),
              records: {
                maxWeight: { value: 110, weight: 110, reps: 3, date: '2026-10-07', entryId: 'c1' },
                maxVolume: { value: 330, weight: 110, reps: 3, date: '2026-10-07', entryId: 'c1' },
                bestE1rm: null,
              },
            },
            baseline: {
              from: q.get('baselineFrom'),
              to: q.get('baselineTo'),
              records: {
                maxWeight: { value: 105, weight: 105, reps: 1, date: '2026-09-20', entryId: 'b1' },
                maxVolume: { value: 500, weight: 100, reps: 5, date: '2026-09-12', entryId: 'b2' },
                bestE1rm: { value: 116.67, weight: 100, reps: 5, date: '2026-09-12', entryId: 'b2' },
              },
            },
            change: {
              maxWeight: { absolute: 5, percent: 4.76 },
              maxVolume: { absolute: -170, percent: -34 },
              bestE1rm: null,
            },
          },
        });
      }),
    );
    return requests;
  }

  it('compares this month so far with last month by default', async () => {
    const requests = serveComparison();
    renderApp('/records?exercise=Bench%20Press');

    const table = await screen.findByRole('table');
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      exerciseName: 'Bench Press',
      unit: 'kg',
      from: '2026-10-01',
      to: '2026-10-16',
      baselineFrom: '2026-09-01',
      baselineTo: '2026-09-30',
    });
    expect(within(table).getByRole('columnheader', { name: /Last month/ })).toHaveTextContent(
      'Sep 1 – Sep 30, 2026',
    );
    expect(within(table).getByRole('columnheader', { name: /This month/ })).toHaveTextContent(
      'Oct 1 – Oct 16, 2026',
    );

    const heaviest = within(table).getByRole('row', { name: /Heaviest single set/ });
    expect(heaviest).toHaveTextContent('105 kg');
    expect(heaviest).toHaveTextContent('110 kg');
    expect(heaviest).toHaveTextContent('+5 kg · +4.76%');
    expect(within(table).getByRole('row', { name: /Highest volume set/ })).toHaveTextContent(
      '-170 kg · -34%',
    );
    // No current record, so no change either.
    const e1rm = within(within(table).getByRole('row', { name: /Best estimated 1RM/ })).getAllByRole('cell');
    expect(e1rm.map((cell) => cell.textContent)).toEqual(['116.67 kgSep 12, 2026', '—', '—']);
  });

  it('switches to week-over-week, with weeks starting on Monday', async () => {
    const requests = serveComparison();
    const { user } = renderApp('/records?exercise=Bench%20Press');
    await screen.findByRole('table');

    await user.click(screen.getByRole('radio', { name: 'Week' }));

    await waitFor(() =>
      expect(Object.fromEntries(requests.at(-1)?.searchParams ?? [])).toMatchObject({
        from: '2026-10-12',
        to: '2026-10-16',
        baselineFrom: '2026-10-05',
        baselineTo: '2026-10-11',
      }),
    );
    expect(await screen.findByRole('columnheader', { name: /This week/ })).toBeInTheDocument();
  });

  it('shows the API message when neither period has data', async () => {
    renderApp('/records?exercise=Deadlift');

    expect(
      await screen.findByText('No Deadlift entries found for this user in either date range.'),
    ).toBeInTheDocument();
  });

  it('offers Try again when the comparison fails', async () => {
    serveComparison();
    let fail = true;
    // Answers first while failing; afterwards it falls through to the handler above.
    server.use(
      http.get('/api/users/:userId/personal-records/comparison', () =>
        fail
          ? HttpResponse.json(
              { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
              { status: 500 },
            )
          : undefined,
      ),
    );
    const { user } = renderApp('/records?exercise=Bench%20Press');

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
