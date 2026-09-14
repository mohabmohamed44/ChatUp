import { Router } from 'express';
import {
  MESSAGE_EVENTS,
  SOCKET_ROOMS,
  messageHistoryQuerySchema,
  type Ack,
  type Message,
  type Page,
} from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import type { Logger } from '../../platform/logger';
import type { StorageService } from '../../platform/storage';
import type { ChatIo } from '../../realtime/io';
import { MessagesService } from './messages.service';

export function createMessagesModule(deps: {
  db: Db;
  config: AppConfig;
  logger: Logger;
  io: ChatIo;
  storage: StorageService;
  requireAuth: import('express').RequestHandler;
}): Router {
  const { db, config, logger, io, storage } = deps;
  const service = new MessagesService(db, io, storage, config, logger);
  const router = Router();

  router.get(
    '/conversations/:conversationId/messages',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const query = messageHistoryQuerySchema.parse(req.query);
      const page: Page<Message> = await service.history(
        req.params.conversationId,
        auth.userId,
        query,
      );
      res.json(page);
    }),
  );

  return router;
}

export function registerMessageSocketEvents(deps: {
  db: Db;
  config: AppConfig;
  logger: Logger;
  io: ChatIo;
  storage: StorageService;
}): void {
  const { db, config, logger, io, storage } = deps;
  const service = new MessagesService(db, io, storage, config, logger);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;

    socket.on(
      MESSAGE_EVENTS.send,
      async (payload, ack: (result: Ack<Message>) => void) => {
        try {
          const message = await service.send(payload, userId);
          ack?.({ ok: true, data: message });
        } catch (err) {
          logger.warn({ err, userId }, 'message:send failed');
          ack?.({
            ok: false,
            error: {
              code: err instanceof Error && 'code' in err ? String(err.code) : 'send_failed',
              message: err instanceof Error ? err.message : 'Failed to send message',
            },
          });
        }
      },
    );

    socket.on(
      MESSAGE_EVENTS.read,
      async (payload, ack: (result: Ack<null>) => void) => {
        try {
          await service.markRead(payload.conversationId, userId, payload.upToMessageId);
          ack?.({ ok: true, data: null });
        } catch (err) {
          logger.warn({ err, userId }, 'message:read failed');
          ack?.({
            ok: false,
            error: { code: 'read_failed', message: 'Failed to mark messages as read' },
          });
        }
      },
    );

    socket.on(
      MESSAGE_EVENTS.sync,
      async (payload, ack: (result: Ack<Page<Message>>) => void) => {
        try {
          const page = await service.sync(
            payload.conversationId,
            userId,
            payload.afterSequence ?? null,
            payload.limit ?? 50,
          );
          ack?.({ ok: true, data: page });
        } catch (err) {
          logger.warn({ err, userId }, 'message:sync failed');
          ack?.({
            ok: false,
            error: { code: 'sync_failed', message: 'Failed to sync messages' },
          });
        }
      },
    );

    socket.on(MESSAGE_EVENTS.new, (payload, ack?: () => void) => {
      void (async () => {
        try {
          if (payload.message.senderId === userId) {
            ack?.();
            return;
          }
          await service.markDelivered(
            payload.message.conversationId,
            userId,
            [payload.message.id],
          );
          ack?.();
        } catch {
          ack?.();
        }
      })();
    });
  });
}
