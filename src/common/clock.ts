/** Injection token for the `Clock`. */
export const CLOCK = Symbol('CLOCK');

/** Source of the current time; injected so tests can pin "today". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
