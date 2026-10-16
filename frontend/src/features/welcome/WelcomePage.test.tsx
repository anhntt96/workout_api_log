import { screen } from '@testing-library/react';
import { USER_ID_KEY } from '../../session/session';
import { USER_ID } from '../../test/fixtures';
import { renderApp } from '../../test/render';

describe('WelcomePage', () => {
  it('rejects an id that is not a UUID and stores nothing', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.type(screen.getByLabelText('Client user ID'), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText(/Enter a UUID such as/)).toBeInTheDocument();
    expect(screen.getByLabelText('Client user ID')).toHaveAttribute('aria-invalid', 'true');
    expect(window.localStorage.getItem(USER_ID_KEY)).toBeNull();
  });

  it('saves a valid id, normalized to lower case, and opens the history', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.type(screen.getByLabelText('Client user ID'), ` ${USER_ID.toUpperCase()} `);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
    expect(window.localStorage.getItem(USER_ID_KEY)).toBe(USER_ID);
  });

  it('generates a new UUID', async () => {
    const { user } = renderApp('/welcome', { userId: null });

    await user.click(screen.getByRole('button', { name: 'Generate a new client ID' }));

    expect(screen.getByLabelText<HTMLInputElement>('Client user ID').value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('prefills the saved id when switching clients', () => {
    renderApp('/welcome');

    expect(screen.getByLabelText('Client user ID')).toHaveValue(USER_ID);
  });
});
