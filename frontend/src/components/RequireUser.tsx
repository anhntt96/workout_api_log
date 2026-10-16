import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from '../session/session';

/** Sends visitors who have not chosen a client to the welcome screen. */
export function RequireUser({ children }: { children: ReactNode }) {
  const { userId } = useSession();
  return userId === null ? <Navigate to="/welcome" replace /> : children;
}
