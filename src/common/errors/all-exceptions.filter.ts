import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
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
  if (isClientHttpError(exception)) {
    // Raised by Express middleware that Nest does not map itself, such as body-parser's 413 (oversized
    // body) or 415 (unsupported charset). The message is shown only when the error marks it safe to expose.
    const message = exception.expose === true ? exception.message : (STATUS_CODES[exception.status] ?? 'Bad Request');
    return httpError(exception.status, message);
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

function httpError(statusCode: number, message: string): Omit<ErrorResponseBody, 'requestId'> {
  const fallback = statusCode >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
  return { statusCode, code: CODE_BY_STATUS[statusCode] ?? fallback, message };
}

/** Any 4xx error carrying a numeric `status`, such as an `http-errors` error from Express. */
function isClientHttpError(value: unknown): value is { status: number; message: string; expose?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const { status } = value as { status?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500;
}
