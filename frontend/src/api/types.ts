// Shapes of the Workout Logging API (README "API"; src/workouts/workout-entry.presenter.ts and
// src/personal-records/personal-records.ts in the backend). Kept by hand: the API has no OpenAPI document yet.

export type WeightUnit = 'kg' | 'lb';

export const WEIGHT_UNITS: readonly WeightUnit[] = ['kg', 'lb'];

export interface FieldError {
  /** Path of the offending input, e.g. `entries[2].sets[0].weight`. */
  field: string;
  message: string;
}

/** Body of every API error response. */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  errors?: FieldError[];
  requestId?: string;
}

export interface Exercise {
  name: string;
  muscleGroups: string[];
}

export interface WorkoutSet {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

export interface WorkoutEntry {
  id: string;
  userId: string;
  /** The client's calendar day, `YYYY-MM-DD`. */
  date: string;
  exerciseName: string;
  sets: WorkoutSet[];
  createdAt: string;
}

export interface HistoryPage {
  data: WorkoutEntry[];
  page: { limit: number; nextCursor: string | null };
  /** Present only when the page is empty. */
  message?: string;
}

export type RecordMetric = 'maxWeight' | 'maxVolume' | 'bestE1rm';

export interface PersonalRecord {
  /** The metric's value in the requested unit: the weight, reps × weight, or the Epley estimate. */
  value: number;
  weight: number;
  reps: number;
  /** The day the record was first reached. */
  date: string;
  entryId: string;
}

export type Records = Record<RecordMetric, PersonalRecord | null>;

export interface PersonalRecordsResponse {
  data: { exerciseName: string; unit: WeightUnit; from: string | null; to: string | null; records: Records };
  /** Present only when there are no records. */
  message?: string;
}

export interface MetricChange {
  absolute: number;
  /** null when the baseline value is 0 (bodyweight work). */
  percent: number | null;
}

export interface PeriodRecords {
  from: string;
  to: string;
  records: Records;
}

export interface ComparisonResponse {
  data: {
    exerciseName: string;
    unit: WeightUnit;
    current: PeriodRecords;
    baseline: PeriodRecords;
    change: Record<RecordMetric, MetricChange | null>;
  };
  /** Present only when neither period has data. */
  message?: string;
}

/** One entry of a POST /workout-entries body. Blank numbers are sent as null so the API names the field. */
export interface LogEntryInput {
  date: string;
  exerciseName: string;
  sets: { reps: number | null; weight: number | null; unit: WeightUnit }[];
}

export interface LogResult {
  entries: WorkoutEntry[];
  /** True when the Idempotency-Key had been used before and nothing new was stored. */
  replayed: boolean;
}
