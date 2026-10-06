import { createServer } from 'node:http';
import { config } from './platform/config';
import { createDb } from './platform/db';
import { attachErrorHandling, createHttpApp } from './platform/http';
import { logger } from './platform/logger';
import { StorageService } from './platform/storage';
import { closeQueues, queueHealth, startWorkers } from './platform/queue';
import { createAuthModule } from './modules/auth';
import { createUsersModule } from './modules/users';
import { createConversationsModule } from './modules/conversations';
import { createMessagesModule } from './modules/messages';
import { createMediaModule } from './modules/media';
import { createRealtime } from './realtime/io';

async function main(): Promise<void> {
  const db = createDb();
  const storage = new StorageService(config);

  try {
    await storage.ensureBucket();
  } catch (err) {
    logger.warn({ err }, 'Object storage unavailable at boot; media uploads will fail');
  }

  const auth = createAuthModule({ db, config, logger, storage });
  const usersRouter = createUsersModule({ db, config, storage, requireAuth: auth.requireAuth });

  const app = createHttpApp({
    config,
    logger,
    db,
    routers: [auth.router, usersRouter],
  });

  const server = createServer(app);

  const { io, presence } = createRealtime(server, { config, logger, db, storage });

  const conversationsRouter = createConversationsModule({
    db,
    config,
    logger,
    io,
    storage,
    requireAuth: auth.requireAuth,
  });
  const messagesRouter = createMessagesModule({
    db,
    config,
    logger,
    io,
    storage,
    requireAuth: auth.requireAuth,
  });
  const mediaRouter = createMediaModule({
    db,
    config,
    logger,
    storage,
    requireAuth: auth.requireAuth,
  });

  app.use('/api', conversationsRouter);
  app.use('/api', messagesRouter);
  app.use('/api', mediaRouter);

  app.get('/api/queues/health', (_req, res) => {
    void (async () => {
      res.json(await queueHealth());
    })();
  });

  app.get('/api/queues/dead-letter', (_req, res) => {
    void (async () => {
      const { deadLetterQueue } = await import('./platform/queue');
      const jobs = await deadLetterQueue.getJobs(['waiting', 'active', 'failed'], 0, 50);
      res.json({
        items: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          data: j.data,
          failedReason: j.failedReason,
          timestamp: j.timestamp,
        })),
      });
    })();
  });

  // Registered last so every router above is matched first.
  attachErrorHandling(app, logger);

  // Start BullMQ workers (graceful no-op when Redis is down).
  await startWorkers({ db, config, logger, storage, io, presence });

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'ChatUp server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    io.close();
    server.close(() => {
      void (async () => {
        await presence.stop();
        await closeQueues();
        await db.$disconnect();
        process.exit(0);
      })();
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
