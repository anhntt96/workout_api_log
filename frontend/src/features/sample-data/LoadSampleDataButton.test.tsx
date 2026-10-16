import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LogEntryInput } from '../../api/types';
import { USER_ID, makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

describe('LoadSampleDataButton', () => {
  it('loads sample data into an empty account and shows it', async () => {
    let posted: { key: string | null; entries: LogEntryInput[] } | undefined;
    server.use(
      http.post('/api/users/:userId/workout-entries', async ({ request }) => {
        const body = (await request.json()) as { entries: LogEntryInput[] };
        posted = { key: request.headers.get('Idempotency-Key'), entries: body.entries };
        return HttpResponse.json({ data: [] }, { status: 201 });
      }),
      http.get('/api/users/:userId/workout-entries', () =>
        HttpResponse.json(
          posted
            ? {
                data: [makeEntry({ exerciseName: 'Deadlift', date: '2026-10-16' })],
                page: { limit: 20, nextCursor: null },
              }
            : {
                data: [],
                page: { limit: 20, nextCursor: null },
                message: 'No workout entries match the given filters.',
              },
        ),
      ),
    );
    const { user } = renderApp('/history');

    await user.click(await screen.findByRole('button', { name: 'Load sample data' }));

    expect(await screen.findByRole('heading', { name: 'Deadlift' })).toBeInTheDocument();
    expect(posted?.key).toBe(`sample-data-${USER_ID}`);
    expect(posted?.entries).toHaveLength(48);
    expect(posted?.entries.at(-1)?.date).toBe('2026-10-16');
  });

  it('shows why loading failed', async () => {
    server.use(
      http.post('/api/users/:userId/workout-entries', () =>
        HttpResponse.json(
          { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderApp('/history');

    await user.click(await screen.findByRole('button', { name: 'Load sample data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  });
});
