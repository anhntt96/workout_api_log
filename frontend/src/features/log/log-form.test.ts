import {
  type LogFormState,
  MAX_SETS,
  initialLogForm,
  logFormReducer,
  setCount,
  toLogEntries,
} from './log-form';

function entryKey(state: LogFormState, index = 0) {
  return state.entries[index]!.key;
}

function setKey(state: LogFormState, entryIndex = 0, setIndex = 0) {
  return state.entries[entryIndex]!.sets[setIndex]!.key;
}

describe('logFormReducer', () => {
  it('starts with one empty entry on the given day in the given unit', () => {
    const state = initialLogForm('2026-10-16', 'lb');
    expect(state).toEqual({
      date: '2026-10-16',
      entries: [
        {
          key: expect.any(String),
          exerciseName: '',
          sets: [{ key: expect.any(String), reps: '', weight: '', unit: 'lb' }],
        },
      ],
    });
  });

  it('adds a set that repeats the previous one, with a new key', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, {
      type: 'updateSet',
      entryKey: entryKey(state),
      setKey: setKey(state),
      patch: { reps: '5', weight: '100' },
    });
    state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });

    const [first, second] = state.entries[0]!.sets;
    expect(second).toMatchObject({ reps: '5', weight: '100', unit: 'kg' });
    expect(second!.key).not.toBe(first!.key);
  });

  it('stops adding sets at the API limit', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    for (let i = 0; i < MAX_SETS + 5; i++)
      state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });
    expect(state.entries[0]!.sets).toHaveLength(MAX_SETS);
  });

  it('never removes the last entry or the last set', () => {
    const state = initialLogForm('2026-10-16', 'kg');
    expect(logFormReducer(state, { type: 'removeEntry', entryKey: entryKey(state) })).toBe(state);
    expect(
      logFormReducer(state, { type: 'removeSet', entryKey: entryKey(state), setKey: setKey(state) })
        .entries[0]!.sets,
    ).toHaveLength(1);
  });

  it('adds and removes entries', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, { type: 'addEntry', unit: 'lb' });
    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]!.sets[0]!.unit).toBe('lb');

    state = logFormReducer(state, { type: 'removeEntry', entryKey: entryKey(state, 0) });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]!.sets[0]!.unit).toBe('lb');
  });
});

describe('toLogEntries', () => {
  it('builds the request entries with the session date and numbers', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, {
      type: 'setExercise',
      entryKey: entryKey(state),
      exerciseName: 'Bench Press',
    });
    state = logFormReducer(state, {
      type: 'updateSet',
      entryKey: entryKey(state),
      setKey: setKey(state),
      patch: { reps: '5', weight: '102.5' },
    });

    expect(toLogEntries(state)).toEqual([
      { date: '2026-10-16', exerciseName: 'Bench Press', sets: [{ reps: 5, weight: 102.5, unit: 'kg' }] },
    ]);
  });

  it('sends blank numbers as null and leaves the exercise empty, for the API to report', () => {
    const state = initialLogForm('2026-10-16', 'kg');
    expect(toLogEntries(state)).toEqual([
      { date: '2026-10-16', exerciseName: '', sets: [{ reps: null, weight: null, unit: 'kg' }] },
    ]);
  });

  it('counts sets across entries', () => {
    let state = initialLogForm('2026-10-16', 'kg');
    state = logFormReducer(state, { type: 'addSet', entryKey: entryKey(state) });
    state = logFormReducer(state, { type: 'addEntry', unit: 'kg' });
    expect(setCount(state)).toBe(3);
  });
});
