import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { RequestValidationError } from '../errors/request-validation.error.js';
import { formatFieldPath } from './field-path.js';

/**
 * Validates one controller argument with a Zod schema and returns the parsed output.
 * Field paths are relative to the argument: `entries[0].date` for a body, `limit` for a
 * query object. Issues with the argument as a whole are reported under its name
 * (`userId`) or its kind (`body`, `query`).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const argumentName = metadata.data ?? metadata.type;
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({
        field: issue.path.length > 0 ? formatFieldPath(issue.path) : argumentName,
        message: issue.message,
      })),
    );
  }
}
