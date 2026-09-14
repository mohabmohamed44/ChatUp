import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  LIMITS,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import type { Logger } from '../../platform/logger';
import { createRequireAuth } from './auth.middleware';
import { AuthService, toAuthUser } from './auth.service';
import {
  clearSessionCookies,
  setSessionCookies,
  validateSession,
} from './auth.session';

export interface AuthModule {
  router: Router;
  requireAuth: RequestHandler;
  service: AuthService;
}

export function createAuthModule(deps: {
  db: Db;
  config: AppConfig;
  logger: Logger;
}): AuthModule {
  const { db, config } = deps;
  const service = new AuthService(db, config);
  const requireAuth = createRequireAuth(db);

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
  });

  const router = Router();

  router.post(
    '/auth/register',
    authLimiter,
    asyncHandler(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const { user, session } = await service.register(input);
      setSessionCookies(res, config, session);
      res.status(201).json({ user });
    }),
  );

  router.post(
    '/auth/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const { user, session } = await service.login(input);
      setSessionCookies(res, config, session);
      res.json({ user });
    }),
  );

  router.post(
    '/auth/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      await service.logout(auth.sessionId);
      clearSessionCookies(res, config);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/auth/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = await validateSession(db, req.cookies[LIMITS.SESSION_COOKIE_NAME]);
      if (!session) throw Errors.unauthorized();
      res.json({ user: toAuthUser(session.user) });
    }),
  );

  router.patch(
    '/auth/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const input = updateProfileSchema.parse(req.body);
      const user = await service.updateProfile(auth.userId, input);
      res.json({ user });
    }),
  );

  return { router, requireAuth, service };
}
