import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { WeightUnit } from '../api/types';
import { AppProviders, createQueryClient } from '../providers';
import { AppRoutes } from '../routes';
import { UNIT_KEY, USER_ID_KEY } from '../session/session';
import { USER_ID } from './fixtures';

interface RenderAppOptions {
  /** Client id stored before rendering; null for a first visit. */
  userId?: string | null;
  unit?: WeightUnit;
}

/** Renders the real routes at `route` with a fresh query cache, as a returning visitor by default. */
export function renderApp(route: string, { userId = USER_ID, unit = 'kg' }: RenderAppOptions = {}) {
  if (userId !== null) window.localStorage.setItem(USER_ID_KEY, userId);
  window.localStorage.setItem(UNIT_KEY, unit);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const user = userEvent.setup();
  const view = render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return { user, client, ...view };
}
