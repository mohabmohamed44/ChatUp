import type { RequestHandler } from 'express';
import { LIMITS } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';
import { validateSession } from './auth.session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createRequireAuth(db: Db): RequestHandler {
  return async (req, res, next) => {
    try {
      const session = await validateSession(db, req.cookies[LIMITS.SESSION_COOKIE_NAME]);
      if (!session) {
        throw Errors.unauthorized();
      }
      if (!SAFE_METHODS.has(req.method)) {
        const header = req.headers[LIMITS.CSRF_HEADER_NAME];
        if (header !== session.csrfToken) {
          throw Errors.forbidden('CSRF token missing or invalid');
        }
      }
      req.auth = {
        userId: session.userId,
        sessionId: session.id,
        csrfToken: session.csrfToken,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
