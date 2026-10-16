import type { DayRange } from '../lib/dates';
import { apiRequest } from './client';
import type {
  ComparisonResponse,
  Exercise,
  HistoryPage,
  LogEntryInput,
  LogResult,
  PersonalRecordsResponse,
  WeightUnit,
  WorkoutEntry,
} from './types';

export const HISTORY_PAGE_SIZE = 20;

const userPath = (userId: string) => `/users/${encodeURIComponent(userId)}`;

export async function getExercises(signal?: AbortSignal): Promise<Exercise[]> {
  const { body } = await apiRequest<{ data: Exercise[] }>('/exercises', { signal });
  return body.data;
}

export interface HistoryQuery {
  /** Partial, case-insensitive match. */
  exerciseName?: string;
  muscleGroup?: string;
  from?: string;
  to?: string;
  unit: WeightUnit;
  cursor?: string;
}

export async function getHistory(
  userId: string,
  query: HistoryQuery,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const { body } = await apiRequest<HistoryPage>(`${userPath(userId)}/workout-entries`, {
    query: { ...query, limit: String(HISTORY_PAGE_SIZE) },
    signal,
  });
  return body;
}

export async function getPersonalRecords(
  userId: string,
  exerciseName: string,
  unit: WeightUnit,
  signal?: AbortSignal,
): Promise<PersonalRecordsResponse> {
  const { body } = await apiRequest<PersonalRecordsResponse>(`${userPath(userId)}/personal-records`, {
    query: { exerciseName, unit },
    signal,
  });
  return body;
}

export interface ComparisonQuery {
  exerciseName: string;
  unit: WeightUnit;
  current: DayRange;
  baseline: DayRange;
}

export async function getComparison(
  userId: string,
  query: ComparisonQuery,
  signal?: AbortSignal,
): Promise<ComparisonResponse> {
  const { body } = await apiRequest<ComparisonResponse>(`${userPath(userId)}/personal-records/comparison`, {
    query: {
      exerciseName: query.exerciseName,
      unit: query.unit,
      from: query.current.from,
      to: query.current.to,
      baselineFrom: query.baseline.from,
      baselineTo: query.baseline.to,
    },
    signal,
  });
  return body;
}

/** Bulk, all-or-nothing. Retrying with the same key never stores the entries twice (ADR 0003). */
export async function logWorkouts(
  userId: string,
  entries: LogEntryInput[],
  idempotencyKey: string,
): Promise<LogResult> {
  const { body, headers } = await apiRequest<{ data: WorkoutEntry[] }>(
    `${userPath(userId)}/workout-entries`,
    {
      method: 'POST',
      body: { entries },
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
  return { entries: body.data, replayed: headers.get('Idempotent-Replayed') === 'true' };
}
