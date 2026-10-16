import { Check, Loader2, Plus } from 'lucide-react';
import { type FormEvent, useReducer, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { useExercises, useLogWorkouts } from '../../api/queries';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Field';
import { todayIsoDay } from '../../lib/dates';
import { fieldErrorMap } from '../../lib/field-errors';
import { newUuid } from '../../lib/uuid';
import { useActiveSession } from '../../session/session';
import type { HistoryLocationState } from '../history/HistoryPage';
import { EntryFields } from './EntryFields';
import {
  type LogFormAction,
  MAX_ENTRIES,
  initialLogForm,
  logFormReducer,
  setCount,
  toLogEntries,
} from './log-form';

const NO_ERRORS: ReadonlyMap<string, string> = new Map();

export function LogWorkoutPage() {
  const { userId, unit } = useActiveSession();
  const navigate = useNavigate();
  const exercises = useExercises();
  const logWorkouts = useLogWorkouts(userId);
  const today = todayIsoDay();
  const [state, dispatchForm] = useReducer(logFormReducer, undefined, () => initialLogForm(today, unit));
  // One key per form: a retry after a lost response replays instead of storing the session twice (ADR 0003).
  const [idempotencyKey] = useState(() => newUuid());

  const errors = logWorkouts.error instanceof ApiError ? fieldErrorMap(logWorkouts.error.errors) : NO_ERRORS;
  // Every entry carries the session date, so show the first entry date error on the one date field.
  const dateError = [...errors].find(([field]) => /^entries\[\d+\]\.date$/.test(field))?.[1];

  function dispatch(action: LogFormAction) {
    // Errors point at positions (entries[1].sets[0]); after an edit they may point at the wrong row.
    if (logWorkouts.isError) logWorkouts.reset();
    dispatchForm(action);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    logWorkouts.mutate(
      { entries: toLogEntries(state), idempotencyKey },
      {
        onSuccess: ({ entries, replayed }) => {
          const flash = replayed
            ? 'This workout was already saved.'
            : `Saved ${entries.length} ${entries.length === 1 ? 'exercise' : 'exercises'}.`;
          navigate('/history', { state: { flash } satisfies HistoryLocationState });
        },
      },
    );
  }

  const sets = setCount(state);
  return (
    <form noValidate onSubmit={handleSubmit}>
      <PageHeader
        title="Log workout"
        description="Record one session. Weights are stored as entered and converted wherever they are shown."
      />
      {logWorkouts.isError && <ApiErrorAlert error={logWorkouts.error} className="mb-6" />}
      {exercises.isError && (
        <ApiErrorAlert error={exercises.error} onRetry={() => void exercises.refetch()} className="mb-6" />
      )}

      <Card className="p-4 sm:p-5">
        <Input
          label="Session date"
          type="date"
          className="sm:max-w-xs"
          value={state.date}
          max={today}
          onChange={(event) => dispatch({ type: 'setDate', date: event.target.value })}
          error={dateError}
          hint="The client's local day."
        />
      </Card>

      <ol className="mt-4 space-y-4">
        {state.entries.map((entry, index) => (
          <li key={entry.key}>
            <EntryFields
              index={index}
              entry={entry}
              exercises={exercises.data ?? []}
              errors={errors}
              canRemove={state.entries.length > 1}
              dispatch={dispatch}
            />
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => dispatch({ type: 'addEntry', unit })}
        disabled={state.entries.length >= MAX_ENTRIES}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-4 text-sm font-medium text-zinc-400 transition-colors hover:border-lime-400/40 hover:text-lime-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400 disabled:opacity-40"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add exercise
      </button>

      <div className="sticky bottom-20 z-10 mt-6 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900/90 p-3 pl-5 shadow-2xl shadow-black/40 backdrop-blur lg:bottom-4">
        <p className="text-sm text-zinc-400 tabular-nums">
          {state.entries.length} {state.entries.length === 1 ? 'exercise' : 'exercises'} · {sets}{' '}
          {sets === 1 ? 'set' : 'sets'}
        </p>
        <Button type="submit" disabled={logWorkouts.isPending}>
          {logWorkouts.isPending ? (
            <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          ) : (
            <Check aria-hidden="true" className="size-4" />
          )}
          Save workout
        </Button>
      </div>
    </form>
  );
}
