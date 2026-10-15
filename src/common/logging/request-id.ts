import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE_REQUEST_ID = /^[\w.-]{1,100}$/;

/** Reuses the caller's X-Request-Id when it looks safe, otherwise generates one, and echoes it back. */
export function assignRequestId(request: IncomingMessage, response: ServerResponse): string {
  const incoming = request.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  response.setHeader('X-Request-Id', id);
  return id;
}
