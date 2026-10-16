import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { WeightUnit } from '../api/types';
import { isUuid } from '../lib/uuid';

export const USER_ID_KEY = 'workout-log.userId';
export const UNIT_KEY = 'workout-log.unit';

export interface Session {
  /** The client whose workouts are shown; null until one is chosen on the welcome screen. */
  userId: string | null;
  setUserId: (userId: string) => void;
  /** The unit every weight in the app is shown and entered in by default. */
  unit: WeightUnit;
  setUnit: (unit: WeightUnit) => void;
}

const SessionContext = createContext<Session | null>(null);

/** Keeps the chosen client and display unit in localStorage so they survive reloads. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState(() => {
    const stored = readStorage(USER_ID_KEY);
    return stored !== null && isUuid(stored) ? stored : null;
  });
  const [unit, setUnitState] = useState<WeightUnit>(() => (readStorage(UNIT_KEY) === 'lb' ? 'lb' : 'kg'));

  const setUserId = useCallback((next: string) => {
    const normalized = next.trim().toLowerCase();
    writeStorage(USER_ID_KEY, normalized);
    setUserIdState(normalized);
  }, []);

  const setUnit = useCallback((next: WeightUnit) => {
    writeStorage(UNIT_KEY, next);
    setUnitState(next);
  }, []);

  const session = useMemo(() => ({ userId, setUserId, unit, setUnit }), [userId, setUserId, unit, setUnit]);
  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/** For pages behind <RequireUser>, where a client is always chosen. */
export function useActiveSession(): Session & { userId: string } {
  const session = useSession();
  if (session.userId === null)
    throw new Error('useActiveSession needs a chosen client; wrap the page in <RequireUser>');
  return { ...session, userId: session.userId };
}

// Storage can be unavailable (private windows, blocked site data); the app then keeps the values in memory only.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory value.
  }
}
