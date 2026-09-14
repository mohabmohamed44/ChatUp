import { Router } from 'express';
import {
  CONVERSATION_EVENTS,
  SOCKET_ROOMS,
  startConversationSchema,
  type ConversationSummary,
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
        await broadcastConversation(io, CONVERSATION_EVENTS.created, conversation.id, conversation);
      }
      res.status(existingCheck ? 200 : 201).json({ conversation });
    }),
  );

  return router;
}

export async function broadcastConversation(
  io: ChatIo,
  event: 'conversation:created' | 'conversation:updated',
  conversationId: string,
  conversation: ConversationSummary,
): Promise<void> {
  io.to(SOCKET_ROOMS.conversation(conversationId)).emit(event, { conversation });
  const service = conversation;
  for (const participant of service.participants) {
    io.to(SOCKET_ROOMS.user(participant.id)).emit(event, { conversation });
  }
}
