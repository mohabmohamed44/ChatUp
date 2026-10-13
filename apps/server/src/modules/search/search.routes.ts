import { Router, type RequestHandler } from 'express';
import { searchMessageSchema, searchConversationsSchema } from '@chatup/shared';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import { searchMessages, searchConversations } from './search.service';

export function createSearchModule(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const { db } = deps;
  const router = Router();

  router.get(
    '/search/messages',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const parsed = searchMessageSchema.parse(req.query);
      const result = await searchMessages(db, auth.userId, parsed);
      res.json(result);
    }),
  );

  router.get(
    '/search/conversations',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const parsed = searchConversationsSchema.parse(req.query);
      const result = await searchConversations(db, auth.userId, parsed);
      res.json({ results: result });
    }),
  );

  return router;
}