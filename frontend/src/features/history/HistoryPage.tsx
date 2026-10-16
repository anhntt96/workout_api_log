import { clsx } from 'clsx';
import { Dumbbell, Loader2, Plus, SearchX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useExercises, useHistory } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClass } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatDayHeading, todayIsoDay } from '../../lib/dates';
import { useActiveSession } from '../../session/session';
import { EntryCard } from './EntryCard';
import {
  type HistoryFilters,
  dateRangeError,
  filtersFromParams,
  filtersToParams,
  hasActiveFilters,
} from './history-filters';
import { HistoryFilterBar } from './HistoryFilters';
import { groupByDay, muscleGroupOptions, muscleGroupsByExercise } from './history-view';

/** Router state the log page leaves behind after saving, shown once as a success banner. */
export interface HistoryLocationState {
  flash?: string;
}

function flashFrom(state: unknown): string | null {
  return typeof state === 'object' &&
    state !== null &&
    typeof (state as HistoryLocationState).flash === 'string'
    ? ((state as HistoryLocationState).flash ?? null)
    : null;
}

export function HistoryPage() {
  const { userId, unit } = useActiveSession();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState(() => flashFrom(location.state));

  // Drop the flash from history state so a reload or Back does not show it again.
  useEffect(() => {
    if (flashFrom(location.state) !== null)
      navigate({ search: location.search }, { replace: true, state: null });
  }, [location.state, location.search, navigate]);

  const filters = filtersFromParams(params);
  const rangeError = dateRangeError(filters);
  const exercises = useExercises();
  const catalog = exercises.data ?? [];
  const history = useHistory(
    userId,
    {
      exerciseName: filters.exercise || undefined,
      muscleGroup: filters.muscleGroup || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      unit,
    },
    rangeError === null,
  );

  const updateFilters = useCallback(
    (patch: Partial<HistoryFilters>) =>
      setParams((current) => filtersToParams({ ...filtersFromParams(current), ...patch }), { replace: true }),
    [setParams],
  );
  const clearFilters = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const entries = history.data?.pages.flatMap((page) => page.data) ?? [];
  const groupsByExercise = muscleGroupsByExercise(catalog);
  const today = todayIsoDay();

  let content;
  if (rangeError !== null) {
    content = null;
  } else if (history.isPending) {
    content = (
      <div className="space-y-3" aria-label="Loading workouts">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  } else if (history.isError) {
    content = (
      <div className="space-y-3">
        <ApiErrorAlert error={history.error} />
        <Button variant="secondary" onClick={() => void history.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    content = hasActiveFilters(filters) ? (
      <EmptyState
        icon={SearchX}
        title="No matching workouts"
        description={history.data.pages[0]?.message ?? 'No workout entries match the given filters.'}
      >
        <Button variant="secondary" onClick={clearFilters}>
          Clear filters
        </Button>
      </EmptyState>
    ) : (
      <EmptyState
        icon={Dumbbell}
        title="No workouts yet"
        description="Log this client's first session to see it here."
      >
        <Link to="/log" className={buttonClass('primary')}>
          <Plus aria-hidden="true" className="size-4" />
          Log workout
        </Link>
      </EmptyState>
    );
  } else {
    content = (
      <div className={clsx('space-y-8 transition-opacity', history.isPlaceholderData && 'opacity-60')}>
        {groupByDay(entries).map((group) => (
          <section key={group.day} aria-labelledby={`day-${group.day}`}>
            <h2
              id={`day-${group.day}`}
              className="sticky top-16 z-10 -mx-1 mb-3 bg-zinc-950/80 px-1 py-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase backdrop-blur"
            >
              {formatDayHeading(group.day, today)}
            </h2>
            <ul className="space-y-3">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} muscleGroups={groupsByExercise.get(entry.exerciseName) ?? []} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="flex justify-center pt-2">
          {history.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage && (
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              )}
              Load more
            </Button>
          ) : (
            <p className="text-sm text-zinc-500">That&apos;s every entry.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Workout history"
        description="Every logged exercise, newest first."
        actions={
          // Phones have the Log tab in the bottom bar.
          <Link to="/log" className={buttonClass('primary', 'md', 'max-sm:hidden')}>
            <Plus aria-hidden="true" className="size-4" />
            Log workout
          </Link>
        }
      />
      {flash && <Alert tone="success" title={flash} onDismiss={() => setFlash(null)} className="mb-6" />}
      {exercises.isError && <ApiErrorAlert error={exercises.error} className="mb-6" />}
      <HistoryFilterBar
        filters={filters}
        muscleGroups={muscleGroupOptions(catalog)}
        rangeError={rangeError}
        onChange={updateFilters}
        onClear={clearFilters}
      />
      <div className="mt-8">{content}</div>
    </>
  );
}
