import { screen, within } from '@testing-library/react';
import { UNIT_KEY, USER_ID_KEY } from '../session/session';
import { USER_ID } from '../test/fixtures';
import { renderApp } from '../test/render';

describe('routing and app shell', () => {
  it('sends a first-time visitor to the welcome screen', () => {
    renderApp('/history', { userId: null });

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
  });

  it('ignores a stored id that is not a UUID', () => {
    window.localStorage.setItem(USER_ID_KEY, 'garbage');
    renderApp('/records', { userId: 'garbage' });

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
  });

  it('still works when localStorage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      renderApp('/history', { userId: null });
      expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it('sends unknown paths to the history', async () => {
    renderApp('/nope');

    expect(await screen.findByRole('heading', { name: 'Workout history' })).toBeInTheDocument();
  });

  it('shows the client and navigates between screens', async () => {
    const { user } = renderApp('/history');

    expect(screen.getByText('0b7e5f0e…5d6e')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Personal records' }));
    expect(await screen.findByRole('heading', { name: 'Personal records' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Personal records' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(nav).getByRole('link', { name: 'Log workout' }));
    expect(await screen.findByRole('heading', { name: 'Log workout' })).toBeInTheDocument();
  });

  it('switches the display unit and remembers it', async () => {
    const { user } = renderApp('/history');
    const units = screen.getByRole('radiogroup', { name: 'Display unit' });

    expect(within(units).getByRole('radio', { name: 'kg' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(units).getByRole('radio', { name: 'lb' }));

    expect(within(units).getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem(UNIT_KEY)).toBe('lb');
  });

  it('opens the welcome screen to switch clients', async () => {
    const { user } = renderApp('/history');

    await user.click(screen.getByRole('link', { name: /Switch client/ }));

    expect(screen.getByRole('heading', { name: 'Choose a client' })).toBeInTheDocument();
    expect(screen.getByLabelText('Client user ID')).toHaveValue(USER_ID);
  });
});
