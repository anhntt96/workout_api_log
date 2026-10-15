import { z } from 'zod';
import { type FieldError, RequestValidationError } from '../errors/request-validation.error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.strictObject({
  entries: z.array(z.strictObject({ reps: z.number().min(1, 'reps must be at least 1') })),
});

function validationErrors(run: () => unknown): FieldError[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RequestValidationError);
    return (error as RequestValidationError).errors;
  }
  throw new Error('expected a RequestValidationError');
}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value', () => {
    expect(pipe.transform({ entries: [{ reps: 5 }] }, { type: 'body' })).toEqual({ entries: [{ reps: 5 }] });
  });

  it('reports every issue with its field path', () => {
    const errors = validationErrors(() =>
      pipe.transform({ entries: [{ reps: 5 }, { reps: 0 }, { reps: -1 }] }, { type: 'body' }),
    );
    expect(errors).toEqual([
      { field: 'entries[1].reps', message: 'reps must be at least 1' },
      { field: 'entries[2].reps', message: 'reps must be at least 1' },
    ]);
  });

  it('names a route parameter after the parameter', () => {
    const uuidPipe = new ZodValidationPipe(z.guid({ error: 'userId must be a UUID' }));
    expect(validationErrors(() => uuidPipe.transform('abc', { type: 'param', data: 'userId' }))).toEqual([
      { field: 'userId', message: 'userId must be a UUID' },
    ]);
  });

  it('reports a problem with the whole body as "body"', () => {
    expect(validationErrors(() => pipe.transform({ entries: [], extra: true }, { type: 'body' }))).toEqual([
      { field: 'body', message: 'Unrecognized key: "extra"' },
    ]);
  });
});
