import type { Server as HttpServer } from 'node:http';
import cookie from 'cookie';
import { Server } from 'socket.io';
import {
  LIMITS,
  PRESENCE_EVENTS,
  SOCKET_ROOMS,
  type ClientToServerEvents,
  type PresenceUpdate,
  type ServerToClientEvents,
  type SocketData,
} from '@chatup/shared';
import type { AppConfig } from '../platform/config';
import type { Db } from '../platform/db';
import type { Logger } from '../platform/logger';
import { validateSession } from '../modules/auth/auth.session';
import { PresenceService } from '../modules/presence/presence.service';
import { registerMessageSocketEvents } from '../modules/messages/messages.routes';

export type ChatIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface Realtime {
  io: ChatIo;
  presence: PresenceService;
}

export function createRealtime(
  httpServer: HttpServer,
  deps: {
    config: AppConfig;
    logger: Logger;
    db: Db;
    storage: import('../platform/storage').StorageService;
  },
): Realtime {
  const presence = new PresenceService(deps.db, deps.logger);
  const io: ChatIo = new Server(httpServer, {
    cors: { origin: deps.config.corsOrigins, credentials: true },
  });
  presence.bind(io);

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie ?? '');
      const session = await validateSession(deps.db, cookies[LIMITS.SESSION_COOKIE_NAME]);
      if (!session) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.userId = session.userId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  registerMessageSocketEvents({
    db: deps.db,
    config: deps.config,
    logger: deps.logger,
    io,
    storage: deps.storage,
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(SOCKET_ROOMS.user(userId));

    socket.on('typing:start', (payload) => {
      socket.to(SOCKET_ROOMS.conversation(payload.conversationId)).emit('typing:update', {
        conversationId: payload.conversationId,
        userId,
        isTyping: true,
      });
    });

    socket.on(PRESENCE_EVENTS.snapshot, (userIds) => {
      const ids = Array.isArray(userIds)
        ? userIds.filter((id) => typeof id === 'string').slice(0, LIMITS.PRESENCE_SNAPSHOT_MAX_IDS)
        : [];
      const snapshot = presence.getSnapshot(ids);
      for (const [snapshotUserId, status] of Object.entries(snapshot)) {
        const update: PresenceUpdate = {
          userId: snapshotUserId,
          status,
          at: new Date().toISOString(),
        };
        socket.emit(PRESENCE_EVENTS.update, update);
      }
    });

    socket.on('disconnect', () => {
      presence.onDisconnect(userId, socket.id);
    });

    void (async () => {
      try {
        const memberships = await deps.db.conversationParticipant.findMany({
          where: { userId },
          select: { conversationId: true },
        });
        for (const membership of memberships) {
          socket.join(SOCKET_ROOMS.conversation(membership.conversationId));
        }
      } catch (err) {
        deps.logger.error({ err, userId }, 'Failed to join conversation rooms');
      }
      if (socket.connected) {
        await presence.onConnect(userId, socket.id);
      }
    })();
  });

  return { io, presence };
}
