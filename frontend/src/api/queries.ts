import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ComparisonQuery,
  type HistoryQuery,
  getComparison,
  getExercises,
  getHistory,
  getPersonalRecords,
  logWorkouts,
} from './endpoints';
import type { LogEntryInput, WeightUnit } from './types';

export const queryKeys = {
  exercises: ['exercises'] as const,
  history: (userId: string) => ['history', userId] as const,
  records: (userId: string) => ['records', userId] as const,
};

/** The fixed catalog only changes with a backend deploy. */
export function useExercises() {
  return useQuery({
    queryKey: queryKeys.exercises,
    queryFn: ({ signal }) => getExercises(signal),
    staleTime: Infinity,
  });
}

export function useHistory(userId: string, query: Omit<HistoryQuery, 'cursor'>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.history(userId), query],
    queryFn: ({ pageParam, signal }) => getHistory(userId, { ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePersonalRecords(userId: string, exerciseName: string, unit: WeightUnit) {
  return useQuery({
    queryKey: [...queryKeys.records(userId), 'all-time', exerciseName, unit],
    queryFn: ({ signal }) => getPersonalRecords(userId, exerciseName, unit, signal),
    placeholderData: keepPreviousData,
    enabled: exerciseName !== '',
  });
}

export function useComparison(userId: string, query: ComparisonQuery) {
  return useQuery({
    queryKey: [...queryKeys.records(userId), 'comparison', query],
    queryFn: ({ signal }) => getComparison(userId, query, signal),
    placeholderData: keepPreviousData,
    enabled: query.exerciseName !== '',
  });
}

/** Logs entries, then marks everything derived from them (history pages and records) stale. */
export function useLogWorkouts(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entries, idempotencyKey }: { entries: LogEntryInput[]; idempotencyKey: string }) =>
      logWorkouts(userId, entries, idempotencyKey),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.history(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.records(userId) }),
      ]),
  });
}
