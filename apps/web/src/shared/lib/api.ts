import { LIMITS, type ApiErrorBody } from '@chatup/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET';
  const headers = new Headers();

  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const csrfToken = readCookie(LIMITS.CSRF_COOKIE_NAME);
    if (csrfToken) headers.set(LIMITS.CSRF_HEADER_NAME, csrfToken);
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  // Handle expired or missing session globally.
  // Any 401 dispatches an event that the AuthProvider listens for.
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('chatup:unauthorized'));
    }
  }

  if (!response.ok) {
    let code = 'request_failed';
    let message = `Request failed with status ${response.status}`;
    let details: unknown;
    try {
      const parsed = (await response.json()) as ApiErrorBody;
      if (parsed.error) {
        code = parsed.error.code ?? code;
        message = parsed.error.message ?? message;
        details = parsed.error.details;
      }
    } catch {
      // Response body was not JSON; keep the fallback error info.
    }
    throw new ApiError(response.status, code, message, details);
  }

  return (await response.json()) as T;
}