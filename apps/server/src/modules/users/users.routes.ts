import { Router, type RequestHandler } from 'express';
import { LIMITS, type PublicUser } from '@chatup/shared';
import { z } from 'zod';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';

const searchQuerySchema = z
  .string()
  .trim()
  .min(LIMITS.SEARCH_QUERY_MIN)
  .max(100);

export class UsersService {
  constructor(private readonly db: Db) {}

  async search(query: string, excludeUserId: string): Promise<PublicUser[]> {
    const users = await this.db.user.findMany({
      where: {
        AND: [
          { id: { not: excludeUserId } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
      take: LIMITS.SEARCH_RESULTS_MAX,
    });
    return users.map((u: { id: string; displayName: string }) => ({ id: u.id, displayName: u.displayName, avatarUrl: null }));
  }
}

export function createUsersModule(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const service = new UsersService(deps.db);
  const router = Router();

  router.get(
    '/users/search',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const query = searchQuerySchema.parse(req.query.q);
      const users = await service.search(query, auth.userId);
      res.json({ users });
    }),
  );

  return router;
}
