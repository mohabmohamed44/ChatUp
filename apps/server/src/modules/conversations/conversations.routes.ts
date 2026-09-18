import { Router } from 'express';
import {
  CONVERSATION_EVENTS,
  SOCKET_ROOMS,
  startConversationSchema,
} from '@chatup/shared';
import type { Db } from '../../platform/db';
import { asyncHandler, Errors } from '../../platform/errors';
import type { Logger } from '../../platform/logger';
import type { ChatIo } from '../../realtime/io';
import { ConversationsService } from './conversations.service';

export function createConversationsModule(deps: {
  db: Db;
  logger: Logger;
  io: ChatIo;
  requireAuth: import('express').RequestHandler;
}): Router {
  const { db, io } = deps;
  const service = new ConversationsService(db);
  const router = Router();

  router.get(
    '/conversations',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const conversations = await service.listForUser(auth.userId);
      res.json({ conversations });
    }),
  );

  router.post(
    '/conversations/direct',
    deps.requireAuth,
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw Errors.unauthorized();
      const { userId } = startConversationSchema.parse(req.body);

      const existingCheck = await db.conversation.findFirst({
        where: {
          AND: [
            { participants: { some: { userId: auth.userId } } },
            { participants: { some: { userId } } },
          ],
        },
        select: { id: true },
      });

      const conversation = await service.startDirect(auth.userId, userId);

      if (!existingCheck) {
        await broadcastConversation(io, CONVERSATION_EVENTS.created, conversation.id, service);
      }
      res.status(existingCheck ? 200 : 201).json({ conversation });
    }),
  );

  return router;
}

/**
 * Broadcasts a conversation event to each participant using a summary computed
 * for that specific viewer. Summaries are not interchangeable: `participants`
 * excludes the viewer and `unreadCount` is per viewer.
 */
export async function broadcastConversation(
  io: ChatIo,
  event: 'conversation:created' | 'conversation:updated',
  conversationId: string,
  service: ConversationsService,
): Promise<void> {
  const participantIds = await service.participantIds(conversationId);
  await Promise.all(
    participantIds.map(async (participantId) => {
      const summary = await service.summaryForUser(conversationId, participantId);
      if (!summary) return;
      io.to(SOCKET_ROOMS.user(participantId)).emit(event, { conversation: summary });
    }),
  );
}
