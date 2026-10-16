import { Plus, Trash2, X } from 'lucide-react';
import type { Exercise } from '../../api/types';
import { WEIGHT_UNITS } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Field';
import { type EntryDraft, type LogFormAction, MAX_SETS } from './log-form';

interface EntryFieldsProps {
  index: number;
  entry: EntryDraft;
  exercises: readonly Exercise[];
  /** API field errors by path, e.g. `entries[0].sets[1].weight`. */
  errors: ReadonlyMap<string, string>;
  canRemove: boolean;
  dispatch: (action: LogFormAction) => void;
}

/** One exercise of the session and its sets. */
export function EntryFields({ index, entry, exercises, errors, canRemove, dispatch }: EntryFieldsProps) {
  const number = index + 1;
  const path = `entries[${index}]`;
  const setsError = errors.get(`${path}.sets`);
  return (
    <Card role="group" aria-label={`Exercise ${number}`} className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-[1.375rem] grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-sm font-semibold text-zinc-400 tabular-nums">
          {number}
        </span>
        <Select
          label="Exercise"
          className="flex-1"
          value={entry.exerciseName}
          onChange={(event) =>
            dispatch({ type: 'setExercise', entryKey: entry.key, exerciseName: event.target.value })
          }
          error={errors.get(`${path}.exerciseName`)}
        >
          <option value="">Choose an exercise</option>
          {exercises.map((exercise) => (
            <option key={exercise.name} value={exercise.name}>
              {exercise.name}
            </option>
          ))}
        </Select>
        <Button
          variant="danger"
          className="mt-[1.375rem] w-10 px-0"
          aria-label={`Remove exercise ${number}`}
          disabled={!canRemove}
          onClick={() => dispatch({ type: 'removeEntry', entryKey: entry.key })}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-zinc-500 uppercase">
            <th scope="col" className="w-10 pb-2 font-medium">
              Set
            </th>
            <th scope="col" className="pr-2 pb-2 font-medium">
              Reps
            </th>
            <th scope="col" className="pr-2 pb-2 font-medium">
              Weight
            </th>
            <th scope="col" className="w-20 pr-2 pb-2 font-medium">
              Unit
            </th>
            <th scope="col" className="w-10 pb-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.sets.map((set, setIndex) => {
            const setPath = `${path}.sets[${setIndex}]`;
            const setNumber = setIndex + 1;
            const update = (patch: Partial<Omit<typeof set, 'key'>>) =>
              dispatch({ type: 'updateSet', entryKey: entry.key, setKey: set.key, patch });
            return (
              <tr key={set.key} className="align-top">
                <td className="py-1.5 leading-10 text-zinc-500 tabular-nums">{setNumber}</td>
                <td className="py-1.5 pr-2">
                  <Input
                    label={`Set ${setNumber} reps`}
                    hideLabel
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={set.reps}
                    onChange={(event) => update({ reps: event.target.value })}
                    error={errors.get(`${setPath}.reps`)}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Input
                    label={`Set ${setNumber} weight`}
                    hideLabel
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={set.weight}
                    onChange={(event) => update({ weight: event.target.value })}
                    error={errors.get(`${setPath}.weight`)}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Select
                    label={`Set ${setNumber} unit`}
                    hideLabel
                    value={set.unit}
                    onChange={(event) => update({ unit: event.target.value as typeof set.unit })}
                    error={errors.get(`${setPath}.unit`)}
                  >
                    {WEIGHT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1.5">
                  <Button
                    variant="danger"
                    className="w-10 px-0"
                    aria-label={`Remove set ${setNumber}`}
                    disabled={entry.sets.length === 1}
                    onClick={() => dispatch({ type: 'removeSet', entryKey: entry.key, setKey: set.key })}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {setsError && <p className="mt-2 text-xs text-rose-300">{setsError}</p>}
      <p className="mt-2 text-xs text-zinc-500">Enter 0 as the weight for bodyweight sets.</p>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        disabled={entry.sets.length >= MAX_SETS}
        onClick={() => dispatch({ type: 'addSet', entryKey: entry.key })}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add set
      </Button>
    </Card>
  );
}
