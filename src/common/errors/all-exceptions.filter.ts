import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type FieldError, RequestValidationError } from './request-validation.error.js';

/** Body of every error response. */
export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  errors?: FieldError[];
  requestId?: string;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  503: 'SERVICE_UNAVAILABLE',
};

/** Renders every error in one format. Unexpected errors become a generic 500 and are logged. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }
    // pino-http (Task 5) sets `request.id`; read it structurally so this file does not depend on its typings.
    const { id } = request as Request & { id?: unknown };
    const payload: ErrorResponseBody = { ...body, requestId: typeof id === 'string' ? id : undefined };
    response.status(body.statusCode).json(payload);
  }
}

function toErrorBody(exception: unknown): Omit<ErrorResponseBody, 'requestId'> {
  if (exception instanceof RequestValidationError) {
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: exception.message, errors: exception.errors };
  }
  if (exception instanceof HttpException) {
    return httpError(exception.getStatus(), exception.message);
  }
  if (isExposedClientError(exception)) {
    // Raised by Express middleware such as body-parser, e.g. 413 for an oversized body.
    return httpError(exception.status, exception.message);
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

function httpError(statusCode: number, message: string): Omit<ErrorResponseBody, 'requestId'> {
  const fallback = statusCode >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  return { statusCode, code: CODE_BY_STATUS[statusCode] ?? fallback, message };
}

/** An `http-errors` 4xx that is safe to show the client (`expose: true`). */
function isExposedClientError(value: unknown): value is { status: number; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { status, expose } = value as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}
