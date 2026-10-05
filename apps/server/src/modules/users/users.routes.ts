import { Router, type RequestHandler } from 'express';
import { LIMITS, type PublicUser } from '@chatup/shared';
import { z } from 'zod';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import type { StorageService } from '../../platform/storage';

const searchQuerySchema = z
  .string()
  .trim()
  .min(LIMITS.SEARCH_QUERY_MIN)
  .max(100);

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  async search(query: string, excludeUserId: string): Promise<PublicUser[]> {
    const users = await this.db.user.findMany({
      where: {
        AND: [
          { id: { not: excludeUserId } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, displayName: true, avatarMediaId: true },
      orderBy: { displayName: 'asc' },
      take: LIMITS.SEARCH_RESULTS_MAX,
    });
    return Promise.all(
      users.map(async (u): Promise<PublicUser> => ({
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarMediaId
          ? await this.storage.signedGetUrl(
              `attachments/${u.avatarMediaId}`,
              this.config.MEDIA_URL_TTL_SECONDS,
            )
          : null,
      })),
    );
  }
}

export function createUsersModule(deps: {
  db: Db;
  config: AppConfig;
  storage: StorageService;
  requireAuth: RequestHandler;
}): Router {
  const service = new UsersService(deps.db, deps.storage, deps.config);
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
