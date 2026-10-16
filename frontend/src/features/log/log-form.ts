import type { LogEntryInput, WeightUnit } from '../../api/types';

/** The API accepts at most 50 entries per request and 50 sets per entry. */
export const MAX_ENTRIES = 50;
export const MAX_SETS = 50;

// Number fields stay strings while editing, so a cleared field is '' rather than 0.
export interface SetDraft {
  key: string;
  reps: string;
  weight: string;
  unit: WeightUnit;
}

export interface EntryDraft {
  key: string;
  exerciseName: string;
  sets: SetDraft[];
}

/** One session: a single date shared by every entry. */
export interface LogFormState {
  date: string;
  entries: EntryDraft[];
}

export type LogFormAction =
  | { type: 'setDate'; date: string }
  | { type: 'addEntry'; unit: WeightUnit }
  | { type: 'removeEntry'; entryKey: string }
  | { type: 'setExercise'; entryKey: string; exerciseName: string }
  | { type: 'addSet'; entryKey: string }
  | { type: 'removeSet'; entryKey: string; setKey: string }
  | { type: 'updateSet'; entryKey: string; setKey: string; patch: Partial<Omit<SetDraft, 'key'>> };

let lastKey = 0;
const nextKey = () => `draft-${++lastKey}`;

const emptySet = (unit: WeightUnit): SetDraft => ({ key: nextKey(), reps: '', weight: '', unit });
const emptyEntry = (unit: WeightUnit): EntryDraft => ({
  key: nextKey(),
  exerciseName: '',
  sets: [emptySet(unit)],
});

export function initialLogForm(today: string, unit: WeightUnit): LogFormState {
  return { date: today, entries: [emptyEntry(unit)] };
}

export function logFormReducer(state: LogFormState, action: LogFormAction): LogFormState {
  switch (action.type) {
    case 'setDate':
      return { ...state, date: action.date };
    case 'addEntry':
      return state.entries.length >= MAX_ENTRIES
        ? state
        : { ...state, entries: [...state.entries, emptyEntry(action.unit)] };
    case 'removeEntry':
      return state.entries.length === 1
        ? state
        : { ...state, entries: state.entries.filter((entry) => entry.key !== action.entryKey) };
    case 'setExercise':
      return updateEntry(state, action.entryKey, (entry) => ({
        ...entry,
        exerciseName: action.exerciseName,
      }));
    case 'addSet':
      // A new set repeats the previous one: most sessions repeat the same reps and weight.
      return updateEntry(state, action.entryKey, (entry) => {
        const last = entry.sets.at(-1);
        if (last === undefined || entry.sets.length >= MAX_SETS) return entry;
        return { ...entry, sets: [...entry.sets, { ...last, key: nextKey() }] };
      });
    case 'removeSet':
      return updateEntry(state, action.entryKey, (entry) =>
        entry.sets.length === 1
          ? entry
          : { ...entry, sets: entry.sets.filter((set) => set.key !== action.setKey) },
      );
    case 'updateSet':
      return updateEntry(state, action.entryKey, (entry) => ({
        ...entry,
        sets: entry.sets.map((set) => (set.key === action.setKey ? { ...set, ...action.patch } : set)),
      }));
  }
}

function updateEntry(
  state: LogFormState,
  entryKey: string,
  update: (entry: EntryDraft) => EntryDraft,
): LogFormState {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.key === entryKey ? update(entry) : entry)),
  };
}

/**
 * The request body's entries. Nothing is validated here: blank numbers become null and an unchosen
 * exercise stays '', so the API reports every problem with its field path (one source of rules).
 */
export function toLogEntries(state: LogFormState): LogEntryInput[] {
  return state.entries.map((entry) => ({
    date: state.date,
    exerciseName: entry.exerciseName,
    sets: entry.sets.map((set) => ({
      reps: toNumber(set.reps),
      weight: toNumber(set.weight),
      unit: set.unit,
    })),
  }));
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function setCount(state: LogFormState): number {
  return state.entries.reduce((total, entry) => total + entry.sets.length, 0);
}
