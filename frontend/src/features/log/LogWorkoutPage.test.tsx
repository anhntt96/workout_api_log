import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LogEntryInput } from '../../api/types';
import { hideRandomUuid, makeEntry } from '../../test/fixtures';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

interface Posted {
  key: string | null;
  body: { entries: LogEntryInput[] };
}

function captureLogs(
  respond: (posted: Posted) => Response = () =>
    HttpResponse.json({ data: [makeEntry(), makeEntry()] }, { status: 201 }),
) {
  const posts: Posted[] = [];
  server.use(
    http.post('/api/users/:userId/workout-entries', async ({ request }) => {
      const posted = {
        key: request.headers.get('Idempotency-Key'),
        body: (await request.json()) as Posted['body'],
      };
      posts.push(posted);
      return respond(posted);
    }),
  );
  return posts;
}

const exercise = (number: number) => screen.getByRole('group', { name: `Exercise ${number}` });

describe('LogWorkoutPage', () => {
  it('logs a session of several exercises and returns to the history with a confirmation', async () => {
    const posts = captureLogs();
    const { user } = renderApp('/log');
    await screen.findByRole('option', { name: 'Bench Press' });

    const first = exercise(1);
    await user.selectOptions(within(first).getByLabelText('Exercise'), 'Bench Press');
    await user.type(within(first).getByLabelText('Set 1 reps'), '5');
    await user.type(within(first).getByLabelText('Set 1 weight'), '100');
    await user.click(within(first).getByRole('button', { name: 'Add set' }));
    await user.clear(within(first).getByLabelText('Set 2 weight'));
    await user.type(within(first).getByLabelText('Set 2 weight'), '102.5');

    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    const second = exercise(2);
    await user.selectOptions(within(second).getByLabelText('Exercise'), 'Back Squat');
    await user.type(within(second).getByLabelText('Set 1 reps'), '5');
    await user.type(within(second).getByLabelText('Set 1 weight'), '225');
    await user.selectOptions(within(second).getByLabelText('Set 1 unit'), 'lb');

    expect(screen.getByText('2 exercises · 3 sets')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved 2 exercises.');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[0]?.body).toEqual({
      entries: [
        {
          date: '2026-10-16',
          exerciseName: 'Bench Press',
          sets: [
            { reps: 5, weight: 100, unit: 'kg' },
            { reps: 5, weight: 102.5, unit: 'kg' },
          ],
        },
        { date: '2026-10-16', exerciseName: 'Back Squat', sets: [{ reps: 5, weight: 225, unit: 'lb' }] },
      ],
    });
  });

  it('defaults new sets to the display unit', async () => {
    renderApp('/log', { unit: 'lb' });

    expect(within(exercise(1)).getByLabelText('Set 1 unit')).toHaveValue('lb');
  });

  it('shows API validation errors next to their fields and clears them on edit', async () => {
    captureLogs(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          errors: [
            { field: 'entries[0].exerciseName', message: 'exerciseName must not be empty' },
            { field: 'entries[0].sets[0].reps', message: 'reps is required' },
            {
              field: 'entries[0].date',
              message: 'date must not be after 2026-10-17 (more than one day in the future)',
            },
          ],
          requestId: 'req-7',
        },
        { status: 400 },
      ),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Request validation failed');
    expect(screen.getByRole('alert')).toHaveTextContent('Request ID req-7');
    expect(within(exercise(1)).getByText('exerciseName must not be empty')).toBeInTheDocument();
    expect(within(exercise(1)).getByLabelText('Set 1 reps')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Session date')).toHaveAccessibleDescription(
      'date must not be after 2026-10-17 (more than one day in the future)',
    );

    await user.type(within(exercise(1)).getByLabelText('Set 1 reps'), '5');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(exercise(1)).queryByText('exerciseName must not be empty')).not.toBeInTheDocument();
  });

  it('still works where crypto.randomUUID is missing (plain-http origins such as a LAN address)', async () => {
    const restore = hideRandomUuid();
    try {
      const posts = captureLogs();
      const { user } = renderApp('/log');

      await user.click(screen.getByRole('button', { name: 'Save workout' }));

      await screen.findByRole('heading', { name: 'Workout history' });
      expect(posts[0]?.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      restore();
    }
  });

  it('reuses the Idempotency-Key when retrying after a network failure', async () => {
    let attempt = 0;
    const posts = captureLogs(() =>
      ++attempt === 1 ? HttpResponse.error() : HttpResponse.json({ data: [makeEntry()] }, { status: 201 }),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the API');
    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).toBe(posts[0]?.key);
  });

  it('sends one key however often Save is clicked, so the API stores the session once', async () => {
    const posts = captureLogs();
    const { user } = renderApp('/log');

    await user.dblClick(screen.getByRole('button', { name: 'Save workout' }));

    await screen.findByRole('heading', { name: 'Workout history' });
    expect(new Set(posts.map((post) => post.key)).size).toBe(1);
  });

  it('tells the coach when the API had already stored this workout', async () => {
    captureLogs(() =>
      HttpResponse.json({ data: [makeEntry()] }, { status: 201, headers: { 'Idempotent-Replayed': 'true' } }),
    );
    const { user } = renderApp('/log');

    await user.click(screen.getByRole('button', { name: 'Save workout' }));

    expect(await screen.findByRole('status')).toHaveTextContent('This workout was already saved.');
  });

  it('removes sets and exercises but always keeps one of each', async () => {
    const { user } = renderApp('/log');

    expect(within(exercise(1)).getByRole('button', { name: 'Remove set 1' })).toBeDisabled();
    expect(within(exercise(1)).getByRole('button', { name: 'Remove exercise 1' })).toBeDisabled();

    await user.click(within(exercise(1)).getByRole('button', { name: 'Add set' }));
    await user.click(within(exercise(1)).getByRole('button', { name: 'Remove set 2' }));
    expect(within(exercise(1)).queryByLabelText('Set 2 reps')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    await user.click(within(exercise(2)).getByRole('button', { name: 'Remove exercise 2' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Exercise 2' })).not.toBeInTheDocument());
  });
});
