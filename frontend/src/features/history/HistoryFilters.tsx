import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Field';
import { capitalize } from '../../lib/format';
import { type HistoryFilters, hasActiveFilters } from './history-filters';

/** Typing pauses this long before the search reaches the URL and the API. */
export const SEARCH_DEBOUNCE_MS = 300;

interface HistoryFilterBarProps {
  filters: HistoryFilters;
  muscleGroups: readonly string[];
  rangeError: string | null;
  onChange: (patch: Partial<HistoryFilters>) => void;
  onClear: () => void;
}

export function HistoryFilterBar({
  filters,
  muscleGroups,
  rangeError,
  onChange,
  onClear,
}: HistoryFilterBarProps) {
  const [search, setSearch] = useState(filters.exercise);
  const [seenExercise, setSeenExercise] = useState(filters.exercise);
  const timer = useRef<number | undefined>(undefined);

  // The URL changed outside this input (Clear filters in the empty state, Back): show the new value.
  // Comparing with the trimmed text keeps a trailing space the user is still typing after.
  if (filters.exercise !== seenExercise) {
    setSeenExercise(filters.exercise);
    if (filters.exercise !== search.trim()) setSearch(filters.exercise);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleSearch(value: string) {
    setSearch(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange({ exercise: value.trim() }), SEARCH_DEBOUNCE_MS);
  }

  function handleClear() {
    window.clearTimeout(timer.current);
    setSearch('');
    onClear();
  }

  return (
    <Card className="grid grid-cols-2 gap-3 p-4 sm:gap-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-start">
      <Input
        label="Exercise"
        className="col-span-2 lg:col-span-1"
        type="search"
        placeholder="Search, e.g. squat"
        icon={<Search aria-hidden="true" className="size-4" />}
        value={search}
        onChange={(event) => handleSearch(event.target.value)}
      />
      <Select
        label="Muscle group"
        className="col-span-2 lg:col-span-1"
        value={filters.muscleGroup}
        onChange={(event) => onChange({ muscleGroup: event.target.value })}
      >
        <option value="">All muscle groups</option>
        {muscleGroups.map((group) => (
          <option key={group} value={group}>
            {capitalize(group)}
          </option>
        ))}
      </Select>
      <Input
        label="From"
        type="date"
        value={filters.from}
        onChange={(event) => onChange({ from: event.target.value })}
        error={rangeError}
      />
      <Input
        label="To"
        type="date"
        value={filters.to}
        onChange={(event) => onChange({ to: event.target.value })}
      />
      <Button
        variant="ghost"
        className="col-span-2 lg:col-span-1 lg:mt-[1.375rem]"
        onClick={handleClear}
        disabled={!hasActiveFilters(filters) && search === ''}
      >
        <X aria-hidden="true" className="size-4" />
        Clear
      </Button>
    </Card>
  );
}
