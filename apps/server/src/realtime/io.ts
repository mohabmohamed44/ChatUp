import type { Server as HttpServer } from 'node:http';
import cookie from 'cookie';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import {
  LIMITS,
  MESSAGE_EVENTS,
  PRESENCE_EVENTS,
  sendMessageSchema,
  SOCKET_ROOMS,
  type ClientToServerEvents,
  type PresenceUpdate,
  type ServerToClientEvents,
  type SocketData,
} from '@chatup/shared';
import type { AppConfig } from '../platform/config';
import type { Db } from '../platform/db';
import type { Logger } from '../platform/logger';
import { validateSession, validateSessionByCsrf } from '../modules/auth/auth.session';
import { PresenceService } from '../modules/presence/presence.service';
import { MessagesService } from '../modules/messages/messages.service';
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
    // Load-tuned for Cloud Run (2026-10 full k6 run: 1778 dropped polling
    // sessions at 100 VUs). pingTimeout 60s (vs 20s default) survives the
    // proxy idle timeout and CPU-throttled event loops without declaring live
    // clients dead; upgradeTimeout 30s gives slow networks room to reach
    // websocket. Explicit transports + allowUpgrades pin the polling→websocket
    // upgrade path (Socket.IO defaults today, but load-test clients and some
    // corporate proxies only ever speak polling — never drop that transport).
    // NOTE: no `connectTimeout` here — that is a client-side option, the
    // server type rejects it.
    pingInterval: 25_000,
    pingTimeout: 60_000,
    upgradeTimeout: 30_000,
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
  });

  // Multi-instance fan-out: publishes/broadcasts go through Redis so a worker
  // or a second API instance emits to the correct rooms. Falls back to
  // in-memory when Redis is down (single-instance dev / tests).
  void (async () => {
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { Redis } = await import('ioredis');
      const pub = new Redis(deps.config.REDIS_URL, { maxRetriesPerRequest: null });
      const sub = pub.duplicate();
      await Promise.all([pub.ping(), sub.ping()]);
      io.adapter(createAdapter(pub, sub));
      deps.logger.info('Socket.IO redis-adapter enabled');
    } catch (err) {
      deps.logger.warn({ err }, 'Socket.IO redis-adapter unavailable; using in-memory adapter');
    }
  })();

  presence.bind(io);

  // message:send is owned here (validated + persisted via MessagesService);
  // registerMessageSocketEvents() owns read/sync/edit/delete.
  const messagesService = new MessagesService(
    deps.db,
    io,
    deps.storage,
    deps.config,
    deps.logger,
    presence,
  );

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie ?? '');
      let session = await validateSession(deps.db, cookies[LIMITS.SESSION_COOKIE_NAME]);
      if (!session) {
        // Cross-domain sockets never carry the session cookie (it belongs to
        // the web domain), so fall back to the CSRF token the client sends in
        // the handshake auth payload (see web shared/lib/socket.ts).
        const candidate = socket.handshake.auth?.csrfToken;
        if (typeof candidate === 'string' && candidate.length > 0) {
          session = await validateSessionByCsrf(deps.db, candidate);
        }
      }
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
    presence,
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(SOCKET_ROOMS.user(userId));
    deps.logger.info({ userId, socketId: socket.id }, 'User connected');

    socket.on('typing:start', async (payload) => {
      try {
        // Check if the user actually belongs to this conversation
        const membership = await deps.db.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId: payload.conversationId,
              userId: userId,
            },
          },
        });

        // If they aren't a member, silently ignore (don't throw an error,
        // otherwise attackers can use errors to guess valid conversation IDs)
        if (!membership) {
          return;
        }

        socket.to(SOCKET_ROOMS.conversation(payload.conversationId)).emit('typing:update', {
          conversationId: payload.conversationId,
          userId,
          isTyping: true,
        });
      } catch (err) {
        deps.logger.error({ err, userId }, 'Failed to process typing:start');
      }
    });

    socket.on('typing:stop', async (payload) => {
      try {
        const membership = await deps.db.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId: payload.conversationId,
              userId: userId,
            },
          },
        });

        if (!membership) return;

        socket.to(SOCKET_ROOMS.conversation(payload.conversationId)).emit('typing:update', {
          conversationId: payload.conversationId,
          userId,
          isTyping: false,
        });
      } catch (err) {
        deps.logger.error({ err, userId }, 'Failed to process typing:stop');
      }
    });

    socket.on(MESSAGE_EVENTS.send, async (payload, ack) => {
      try {
        // Enforce schema (required fields, body max length) before touching the
        // service — malformed payloads fail fast without a membership query.
        const input = sendMessageSchema.parse(payload);
        // Critical-path persistence is inline: MessagesService.send() runs the
        // Postgres transaction in this handler and acks immediately after
        // commit (membership check, clientId idempotency, room broadcast).
        const message = await messagesService.send(input, userId);
        ack?.({ ok: true, data: message });
      } catch (err) {
        const invalid = err instanceof ZodError;
        deps.logger.warn(
          { err, userId },
          invalid ? 'Invalid message payload' : 'message:send failed',
        );
        // Return a graceful, typed error to the client instead of crashing
        ack?.({
          ok: false,
          error: invalid
            ? { code: 'invalid_payload', message: 'Invalid message format or too long' }
            : {
                code: err instanceof Error && 'code' in err ? String(err.code) : 'send_failed',
                message: err instanceof Error ? err.message : 'Failed to send message',
              },
        });
      }
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
