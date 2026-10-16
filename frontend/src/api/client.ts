import type { ErrorBody, FieldError } from './types';

/** The app always calls the API through the same-origin `/api` proxy (Vite in development, nginx in Docker). */
const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldError[];
  readonly requestId: string | undefined;

  constructor(body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code;
    this.errors = body.errors ?? [];
    this.requestId = body.requestId;
  }

  /** A 4xx: sending the same request again cannot succeed. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** Empty and undefined values are left out of the query string. */
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  body: T;
  headers: Headers;
}

/** Sends a JSON request; any failure becomes an ApiError in the API's error format. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  // fetch outside a browser (tests) needs an absolute URL; in the browser this is the page's origin.
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(name, value);
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError({
      statusCode: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the API. Check that it is running.',
    });
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(
      isErrorBody(body)
        ? body
        : {
            statusCode: response.status,
            code: 'HTTP_ERROR',
            message: `The API responded with ${response.status} ${response.statusText}`.trim(),
          },
    );
  }
  return { body: body as T, headers: response.headers };
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const { statusCode, code, message } = value as Partial<ErrorBody>;
  return typeof statusCode === 'number' && typeof code === 'string' && typeof message === 'string';
}
