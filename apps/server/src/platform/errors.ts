import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (message = 'Authentication required') =>
    new AppError('unauthorized', 401, message),
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError('forbidden', 403, message),
  notFound: (what = 'Resource') => new AppError('not_found', 404, `${what} not found`),
  conflict: (message: string) => new AppError('conflict', 409, message),
  badRequest: (message: string, details?: unknown) =>
    new AppError('bad_request', 400, message, details),
  validation: (issues: unknown) =>
    new AppError('validation_error', 422, 'Request validation failed', issues),
  rateLimited: (message = 'Too many requests, please slow down') =>
    new AppError('rate_limited', 429, message),
  internal: () => new AppError('internal_error', 500, 'Something went wrong'),
};

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
