import { Router, type RequestHandler } from 'express';
import { pushAckSchema } from '@chatup/shared';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import { NotificationsService } from './notifications.service';

export interface NotificationsModule {
  router: Router;
  service: NotificationsService;
}

export function createNotificationsModule(deps: {
  db: Db;
  requireAuth: RequestHandler;
}): NotificationsModule {
  const service = new NotificationsService(deps.db);
  const router = Router();

  // Service workers cannot read document.cookie, so they can't set the CSRF
  // header a POST requires. The endpoint therefore accepts GET (a safe
  // method: session-cookie authenticated, no CSRF check) for SW beacons, and
  // POST+CSRF for page-side callers. The upsert is idempotent either way.
  router.all(
    '/notifications/push-ack',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const input =
        req.method === 'GET' ? pushAckSchema.parse(req.query) : pushAckSchema.parse(req.body);
      const ack = await service.recordPushAck({ ...input, userId: auth.userId });
      res.json({
        ok: true,
        ack: { messageId: ack.messageId, status: ack.status, at: ack.createdAt.toISOString() },
      });
    }),
  );

  return { router, service };
}
