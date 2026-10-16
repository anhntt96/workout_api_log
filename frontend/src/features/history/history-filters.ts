/** History filters as kept in the URL (`?exercise=squat&muscle=glutes&from=…&to=…`), so reloads and links keep them. */
export interface HistoryFilters {
  exercise: string;
  muscleGroup: string;
  from: string;
  to: string;
}

const PARAM_NAMES: Record<keyof HistoryFilters, string> = {
  exercise: 'exercise',
  muscleGroup: 'muscle',
  from: 'from',
  to: 'to',
};

const FILTER_KEYS = Object.keys(PARAM_NAMES) as (keyof HistoryFilters)[];

export function filtersFromParams(params: URLSearchParams): HistoryFilters {
  return {
    exercise: params.get(PARAM_NAMES.exercise) ?? '',
    muscleGroup: params.get(PARAM_NAMES.muscleGroup) ?? '',
    from: params.get(PARAM_NAMES.from) ?? '',
    to: params.get(PARAM_NAMES.to) ?? '',
  };
}

export function filtersToParams(filters: HistoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key].trim();
    if (value !== '') params.set(PARAM_NAMES[key], value);
  }
  return params;
}

export function hasActiveFilters(filters: HistoryFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key].trim() !== '');
}

/** The API rejects from > to with a 400; the page shows this next to the field instead of sending it. */
export function dateRangeError(filters: HistoryFilters): string | null {
  return filters.from !== '' && filters.to !== '' && filters.from > filters.to
    ? 'From must be on or before To'
    : null;
}
