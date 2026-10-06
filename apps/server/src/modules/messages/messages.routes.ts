import { Router } from 'express';
import {
  MESSAGE_EVENTS,
  SOCKET_ROOMS,
  deleteMessageSchema,
  editMessageSchema,
  markPlayedSchema,
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
import {
  enqueueReadReceipt,
  enqueueMessagePersist,
  getPersistQueueEvents,
  isRedisHealthy,
} from '../../platform/queue';

/** Timeout waiting for the persist worker before falling back to direct send. */
const PERSIST_VIA_QUEUE_TIMEOUT_MS = 8000;

/**
 * Primary send path: durable queue when Redis is healthy, synchronous direct
 * write otherwise. Exactly-once is preserved in both paths by the
 * (conversationId, senderId, clientId) unique constraint — the worker and the
 * fallback share the same idempotency key, so a retry never duplicates.
 */
async function sendViaQueueOrDirect(
  service: MessagesService,
  logger: Logger,
  payload: Parameters<MessagesService['send']>[0],
  senderId: string,
): Promise<Message> {
  if (await isRedisHealthy()) {
    try {
      const job = await enqueueMessagePersist({
        conversationId: payload.conversationId,
        senderId,
        clientId: payload.clientId,
        kind: payload.kind as 'text' | 'image' | 'audio',
        body: payload.body,
        attachmentId: payload.attachmentId,
      });
      const events = getPersistQueueEvents();
      if (events) {
        await job.waitUntilFinished(events, PERSIST_VIA_QUEUE_TIMEOUT_MS);
        const persisted = await service.getByClientId(
          payload.conversationId,
          senderId,
          payload.clientId,
          senderId,
        );
        if (persisted) return persisted;
      }
    } catch (err) {
      logger.debug({ err }, 'queue persist path failed, falling back to direct send');
    }
  }
  return service.send(payload, senderId);
}

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
        req.params.conversationId as string,
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
  presence?: { isOnline(userId: string): boolean };
}): void {
  const { db, config, logger, io, storage, presence } = deps;
  const service = new MessagesService(db, io, storage, config, logger, presence);

  io.on('connection', (socket) => {
    const userId = socket.data.userId;

    socket.on(
      MESSAGE_EVENTS.send,
      async (payload, ack: (result: Ack<Message>) => void) => {
        try {
          const message = await sendViaQueueOrDirect(service, logger, payload, userId);
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
          // Async receipts: enqueue for the worker, fall back to direct write
          // when Redis is down so read states never stall.
          try {
            await enqueueReadReceipt({
              type: 'read',
              conversationId: payload.conversationId,
              userId,
              upToMessageId: payload.upToMessageId,
            });
          } catch {
            await service.markRead(payload.conversationId, userId, payload.upToMessageId);
          }
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

    socket.on(
      MESSAGE_EVENTS.edit,
      async (payload, ack: (result: Ack<Message>) => void) => {
        try {
          const input = editMessageSchema.parse(payload);
          const message = await service.editMessage(input.messageId, userId, input.body);
          ack?.({ ok: true, data: message });
        } catch (err) {
          logger.warn({ err, userId }, 'message:edit failed');
          ack?.({
            ok: false,
            error: {
              code: err instanceof Error && 'code' in err ? String(err.code) : 'edit_failed',
              message: err instanceof Error ? err.message : 'Failed to edit message',
            },
          });
        }
      },
    );

    socket.on(
      MESSAGE_EVENTS.delete,
      async (payload, ack: (result: Ack<Message>) => void) => {
        try {
          const input = deleteMessageSchema.parse(payload);
          const message = await service.deleteMessage(input.messageId, userId);
          ack?.({ ok: true, data: message });
        } catch (err) {
          logger.warn({ err, userId }, 'message:delete failed');
          ack?.({
            ok: false,
            error: {
              code: err instanceof Error && 'code' in err ? String(err.code) : 'delete_failed',
              message: err instanceof Error ? err.message : 'Failed to delete message',
            },
          });
        }
      },
    );

    socket.on(
      MESSAGE_EVENTS.played,
      async (payload, ack: (result: Ack<null>) => void) => {
        try {
          const input = markPlayedSchema.parse(payload);
          await service.markPlayed(input.conversationId, userId, input.messageId);
          ack?.({ ok: true, data: null });
        } catch (err) {
          logger.warn({ err, userId }, 'message:played failed');
          ack?.({
            ok: false,
            error: {
              code: 'played_failed',
              message: err instanceof Error ? err.message : 'Failed to mark as played',
            },
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
          try {
            await enqueueReadReceipt({
              type: 'delivered',
              conversationId: payload.message.conversationId,
              userId,
              messageIds: [payload.message.id],
            });
          } catch {
            await service.markDelivered(
              payload.message.conversationId,
              userId,
              [payload.message.id],
            );
          }
          ack?.();
        } catch {
          ack?.();
        }
      })();
    });
  });
}
