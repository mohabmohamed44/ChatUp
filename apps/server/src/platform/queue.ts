import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config';
import type { FcmService } from './fcm';
import { logger } from './logger';

/**
 * Queue layer — BullMQ on Redis.
 *
 * Realtime path (Socket.IO, direct): typing, presence, live emission.
 * Async path (this file): durability + side effects.
 *
 * Queues:
 * - message-persistence  — async DB persist for socket sends (idempotent via jobId + DB unique constraint)
 * - offline-notifications — fan-out after persist; skips online recipients via PresenceService
 * - media-processing      — thumbnail/validation after upload, orphan cleanup
 * - read-receipts         — delivered/read stamping (aggregated, debounced)
 * - dead-letter           — permanently failed jobs for inspection
 * - session-cleanup / media-cleanup — scheduled hygiene (repeatable jobs)
 *
 * Redis is optional at runtime: if Redis is unreachable the app boots and
 * every enqueue helper throws QueueUnavailableError so callers can fall back
 * to the synchronous path. Tests without Redis therefore keep passing.
 */

export const QUEUES = {
  MESSAGE_PERSISTENCE: 'message-persistence',
  OFFLINE_NOTIFICATIONS: 'offline-notifications',
  MEDIA_PROCESSING: 'media-processing',
  READ_RECEIPTS: 'read-receipts',
  DEAD_LETTER: 'dead-letter',
  // Pre-existing hygiene queues (kept for backwards compatibility).
  MEDIA_CLEANUP: 'media-cleanup',
  SESSION_CLEANUP: 'session-cleanup',
} as const;

export class QueueUnavailableError extends Error {
  constructor(queue: string, cause?: unknown) {
    super(`Queue ${queue} unavailable (Redis down?)`);
    this.name = 'QueueUnavailableError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function makeRedis(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

/** Shared connection used by Queue producers. Workers get their own connections. */
export const redisConnection = makeRedis();
redisConnection.on('error', (err) => {
  logger.warn({ err }, 'Redis connection error (queues degrade to sync fallback)');
});

let redisHealthy: boolean | null = null;

export async function isRedisHealthy(): Promise<boolean> {
  if (redisHealthy !== null) return redisHealthy;
  try {
    const pong = await redisConnection.ping();
    redisHealthy = pong === 'PONG';
  } catch {
    redisHealthy = false;
  }
  // Cache briefly; re-probe on next call after reset.
  if (!redisHealthy) {
    setTimeout(() => {
      redisHealthy = null;
    }, 10_000).unref?.();
  }
  return redisHealthy;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1000 },
};

function makeQueue(name: string, opts = {}) {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: { ...defaultJobOptions, ...opts },
  });
}

export const messagePersistenceQueue = makeQueue(QUEUES.MESSAGE_PERSISTENCE, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
});
export const offlineNotificationsQueue = makeQueue(QUEUES.OFFLINE_NOTIFICATIONS);
export const mediaProcessingQueue = makeQueue(QUEUES.MEDIA_PROCESSING, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
export const readReceiptsQueue = makeQueue(QUEUES.READ_RECEIPTS, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
});
export const deadLetterQueue = makeQueue(QUEUES.DEAD_LETTER, {
  attempts: 1,
});
export const mediaCleanupQueue = makeQueue(QUEUES.MEDIA_CLEANUP, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});
export const sessionCleanupQueue = makeQueue(QUEUES.SESSION_CLEANUP, {
  attempts: 2,
  backoff: { type: 'exponential', delay: 10_000 },
});

export const queues: Record<string, Queue> = {
  [QUEUES.MESSAGE_PERSISTENCE]: messagePersistenceQueue,
  [QUEUES.OFFLINE_NOTIFICATIONS]: offlineNotificationsQueue,
  [QUEUES.MEDIA_PROCESSING]: mediaProcessingQueue,
  [QUEUES.READ_RECEIPTS]: readReceiptsQueue,
  [QUEUES.DEAD_LETTER]: deadLetterQueue,
  [QUEUES.MEDIA_CLEANUP]: mediaCleanupQueue,
  [QUEUES.SESSION_CLEANUP]: sessionCleanupQueue,
};

// ---------------------------------------------------------------------------
// Job payloads
// ---------------------------------------------------------------------------

export interface PersistMessageJob {
  conversationId: string;
  senderId: string;
  clientId: string;
  kind: 'text' | 'image' | 'audio';
  body?: string | null;
  attachmentId?: string | null;
}

export interface OfflineNotificationJob {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientIds: string[];
  preview: string | null;
}

export interface MediaProcessingJob {
  attachmentId: string;
  storageKey: string;
  kind: 'image' | 'audio';
  mimeType: string;
}

export interface ReadReceiptJob {
  type: 'delivered' | 'read';
  conversationId: string;
  userId: string;
  messageIds?: string[];
  upToMessageId?: string;
}

async function addOrThrow<T>(queue: Queue, name: string, data: T, opts: object = {}): Promise<Job<T>> {
  try {
    return await queue.add(name, data, opts);
  } catch (err) {
    throw new QueueUnavailableError(queue.name, err);
  }
}

// ---------------------------------------------------------------------------
// Enqueue helpers (called from routes / realtime handlers)
// ---------------------------------------------------------------------------

/** Idempotency key: same clientId retry reuses the same job. */
export function enqueueMessagePersist(input: PersistMessageJob) {
  // NOTE: BullMQ custom IDs must not contain ':' (reserved separator).
  const jobId = `persist_${input.conversationId}_${input.senderId}_${input.clientId}`;
  return addOrThrow(messagePersistenceQueue, 'persist', input, {
    jobId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

export function enqueueOfflineNotification(job: OfflineNotificationJob) {
  return addOrThrow(offlineNotificationsQueue, 'notify', job, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export function enqueueMediaProcessing(job: MediaProcessingJob) {
  return addOrThrow(mediaProcessingQueue, 'process', job, {
    jobId: `media_${job.attachmentId}`,
    attempts: 3,
  });
}

export function enqueueReadReceipt(job: ReadReceiptJob) {
  // Debounce rapid delivered/read bursts: same (conv,user,type) collapses.
  const dedupeKey =
    job.type === 'read'
      ? `read_${job.conversationId}_${job.userId}_${job.upToMessageId ?? 'latest'}`
      : undefined;
  return addOrThrow(readReceiptsQueue, job.type, job, {
    ...(dedupeKey ? { jobId: dedupeKey } : {}),
    delay: job.type === 'delivered' ? 500 : 1000,
  });
}

export async function scheduleRecurringJobs(): Promise<void> {
  try {
    await sessionCleanupQueue.upsertJobScheduler('hourly', { every: 3_600_000 });
    await mediaCleanupQueue.upsertJobScheduler('abandoned-sweep', { every: 1_800_000 });
    logger.info('Recurring queue jobs scheduled (session + media cleanup)');
  } catch (err) {
    logger.warn({ err }, 'Could not schedule recurring queue jobs (Redis down?)');
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  db: import('./db').Db;
  config: import('./config').AppConfig;
  logger: import('./logger').Logger;
  storage: import('./storage').StorageService;
  fcm: FcmService;
  io: import('../realtime/io').ChatIo;
  presence: { isOnline(userId: string): boolean };
}

const activeWorkers: Worker[] = [];
let queueEvents: QueueEvents | null = null;

async function moveToDeadLetter(queueName: string, job: Job, err: Error): Promise<void> {
  try {
    await deadLetterQueue.add(
      'failed',
      {
        queue: queueName,
        jobId: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
      },
      { removeOnComplete: { count: 1000 } },
    );
  } catch (dlErr) {
    logger.warn({ err: dlErr, queueName }, 'Could not move job to dead-letter queue');
  }
}

function attachDeadLetter(worker: Worker, queueName: string): void {
  worker.on('failed', (job, err) => {
    logger.warn({ err, queueName, jobId: job?.id }, `Job failed in ${queueName}`);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void moveToDeadLetter(queueName, job, err as Error);
    }
  });
}

export async function startWorkers(deps: WorkerDeps): Promise<Worker[]> {
  if (!(await isRedisHealthy())) {
    deps.logger.warn('Redis unreachable — queue workers not started, sync fallback active');
    return [];
  }

  // Lazy import breaks the routes -> queue -> service direction cleanly at
  // runtime (service never imports this module).
  const { MessagesService } = await import('../modules/messages/messages.service');

  const persistWorker = new Worker<PersistMessageJob>(
    QUEUES.MESSAGE_PERSISTENCE,
    async (job) => {
      const svc = new MessagesService(
        deps.db,
        deps.io as never,
        deps.storage,
        deps.config,
        deps.logger,
      );
      const msg = await svc.send(
        {
          conversationId: job.data.conversationId,
          clientId: job.data.clientId,
          kind: job.data.kind,
          body: job.data.body,
          attachmentId: job.data.attachmentId,
        } as never,
        job.data.senderId,
      );
      // Offline fan-out: only recipients currently offline get a job.
      try {
        const { ConversationsService } = await import(
          '../modules/conversations/conversations.service'
        );
        const convSvc = new ConversationsService(deps.db, deps.storage, deps.config);
        const participantIds = await convSvc.participantIds(job.data.conversationId);
        const offline = participantIds.filter(
          (id) => id !== job.data.senderId && !deps.presence.isOnline(id),
        );
        if (offline.length > 0) {
          await enqueueOfflineNotification({
            messageId: msg.id,
            conversationId: job.data.conversationId,
            senderId: job.data.senderId,
            recipientIds: offline,
            preview:
              job.data.kind === 'text'
                ? (job.data.body ?? '').slice(0, 160) || null
                : `[${job.data.kind}]`,
          }).catch((err) => deps.logger.warn({ err }, 'notify enqueue failed'));
        }
      } catch (err) {
        deps.logger.warn({ err }, 'offline fan-out failed');
      }
      return { messageId: msg.id };
    },
    { connection: makeRedis(), concurrency: 10 },
  );

  const receiptsWorker = new Worker<ReadReceiptJob>(
    QUEUES.READ_RECEIPTS,
    async (job) => {
      const svc = new MessagesService(
        deps.db,
        deps.io as never,
        deps.storage,
        deps.config,
        deps.logger,
      );
      if (job.data.type === 'delivered') {
        await svc.markDelivered(job.data.conversationId, job.data.userId, job.data.messageIds ?? []);
      } else {
        await svc.markRead(job.data.conversationId, job.data.userId, job.data.upToMessageId);
      }
    },
    { connection: makeRedis(), concurrency: 20 },
  );

  const notifyWorker = new Worker<OfflineNotificationJob>(
    QUEUES.OFFLINE_NOTIFICATIONS,
    async (job) => {
      // Suppress if the recipient came online while the job was delayed.
      const stillOffline = job.data.recipientIds.filter((id) => !deps.presence.isOnline(id));
      if (stillOffline.length === 0) return { suppressed: true };

      // FCM registrations (FIDs) live on Session (one per device). Only live
      // sessions with an FID can receive push.
      const sessions = await deps.db.session.findMany({
        where: {
          userId: { in: stillOffline },
          fid: { not: null },
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { userId: true, fid: true },
      });
      const tokens = [...new Set(sessions.map((s) => s.fid!.trim()).filter(Boolean))];
      if (tokens.length === 0) {
        deps.logger.info(
          { messageId: job.data.messageId, recipients: stillOffline },
          'offline push skipped: recipients have no registered FCM token',
        );
        return { skipped: true, recipients: stillOffline };
      }

      const sender = await deps.db.user.findUnique({
        where: { id: job.data.senderId },
        select: { displayName: true },
      });

      const result = await deps.fcm.sendPush({
        tokens,
        notification: {
          title: sender?.displayName ?? 'New message',
          ...(job.data.preview ? { body: job.data.preview.slice(0, 160) } : {}),
        },
        data: {
          conversationId: job.data.conversationId,
          messageId: job.data.messageId,
          senderId: job.data.senderId,
          // Service worker shows `رسالة من ${senderName}` for data-only
          // payloads and logs the sender; keep keys as strings for FCM.
          ...(sender?.displayName ? { senderName: sender.displayName } : {}),
        },
      });

      // A job that sent nothing must not look like success in the logs.
      if (result.skippedReason) {
        deps.logger.warn(
          { messageId: job.data.messageId, reason: result.skippedReason },
          'offline push NOT sent',
        );
      }

      // Prune dead registrations so we don't push to them forever.
      if (result.invalidTargets.length > 0) {
        await deps.db.session
          .updateMany({
            where: { fid: { in: result.invalidTargets } },
            data: { fid: null },
          })
          .catch((err) => deps.logger.warn({ err }, 'failed to prune dead FCM registrations'));
      }

      deps.logger.info(
        {
          messageId: job.data.messageId,
          conversationId: job.data.conversationId,
          ...result,
        },
        'offline push sent',
      );
      return { notified: stillOffline, ...result };
    },
    { connection: makeRedis(), concurrency: 5 },
  );

  const mediaWorker = new Worker<MediaProcessingJob>(
    QUEUES.MEDIA_PROCESSING,
    async (job) => {
      const { attachmentId, storageKey, kind } = job.data;
      const attachment = await deps.db.mediaAttachment.findUnique({
        where: { id: attachmentId },
      });
      if (!attachment) {
        deps.logger.warn({ attachmentId }, 'media-processing: attachment gone, skipping');
        return { skipped: true };
      }
      if (kind === 'image') {
        try {
          const { default: sharp } = await import('sharp');
          const buf = await deps.storage.getBuffer(storageKey);
          const image = sharp(buf);
          const meta = await image.metadata();
          // Sibling key (not a child prefix): real GCS is flat, and the
          // fake-gcs-server emulator cannot nest an object under an existing
          // object key ("not a directory").
          const thumbKey = `${storageKey}-thumb-320`;
          const thumb = await sharp(buf)
            .resize({ width: 320, withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          await deps.storage.put(thumbKey, thumb, 'image/jpeg');
          await deps.db.mediaAttachment.update({
            where: { id: attachmentId },
            data: {
              width: meta.width ?? null,
              height: meta.height ?? null,
              status: 'COMPLETED',
            },
          });
          return { thumbKey, width: meta.width, height: meta.height };
        } catch (err) {
          deps.logger.warn({ err, attachmentId }, 'thumbnail generation failed, keeping original');
          await deps.db.mediaAttachment
            .update({ where: { id: attachmentId }, data: { status: 'COMPLETED' } })
            .catch(() => {});
          return { thumbnailSkipped: true };
        }
      }
      // Audio: no transcode in MVP (ffmpeg deferred); just confirm completion.
      await deps.db.mediaAttachment
        .update({ where: { id: attachmentId }, data: { status: 'COMPLETED' } })
        .catch(() => {});
      return { ok: true };
    },
    { connection: makeRedis(), concurrency: 5 },
  );

  const mediaCleanupWorker = new Worker(
    QUEUES.MEDIA_CLEANUP,
    async () => {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const stale = await deps.db.mediaAttachment.findMany({
        where: { status: 'PENDING', createdAt: { lt: cutoff } },
        select: { id: true, storageKey: true },
        take: 100,
      });
      let removed = 0;
      for (const row of stale) {
        try {
          await deps.storage.delete(row.storageKey).catch(() => {});
          await deps.db.mediaAttachment.delete({ where: { id: row.id } });
          removed++;
        } catch (err) {
          deps.logger.warn({ err, id: row.id }, 'media cleanup failed for row');
        }
      }
      // Also sweep ABANDONED rows older than 7 days.
      const oldAbandoned = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const abandoned = await deps.db.mediaAttachment.findMany({
        where: { status: 'ABANDONED', createdAt: { lt: oldAbandoned } },
        select: { id: true, storageKey: true },
        take: 100,
      });
      for (const row of abandoned) {
        try {
          await deps.storage.delete(row.storageKey).catch(() => {});
          await deps.db.mediaAttachment.delete({ where: { id: row.id } });
          removed++;
        } catch (err) {
          deps.logger.warn({ err, id: row.id }, 'abandoned media cleanup failed');
        }
      }
      return { removed };
    },
    { connection: makeRedis(), concurrency: 1 },
  );

  const sessionCleanupWorker = new Worker(
    QUEUES.SESSION_CLEANUP,
    async () => {
      const now = new Date();
      const result = await deps.db.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
      });
      return { removed: result.count };
    },
    { connection: makeRedis(), concurrency: 1 },
  );

  const deadLetterWorker = new Worker(
    QUEUES.DEAD_LETTER,
    async (job) => {
      deps.logger.error(
        { jobId: job.id, data: job.data },
        'dead-letter job awaiting inspection (see /api/queues/dead-letter)',
      );
    },
    { connection: makeRedis(), concurrency: 1 },
  );

  const all = [
    persistWorker,
    receiptsWorker,
    notifyWorker,
    mediaWorker,
    mediaCleanupWorker,
    sessionCleanupWorker,
    deadLetterWorker,
  ];
  for (const w of all) {
    attachDeadLetter(w, w.name);
    w.on('error', (err) => deps.logger.warn({ err, queue: w.name }, 'worker error'));
    activeWorkers.push(w);
  }

  queueEvents = new QueueEvents(QUEUES.MESSAGE_PERSISTENCE, { connection: makeRedis() });
  await scheduleRecurringJobs();
  deps.logger.info(
    { queues: all.map((w) => w.name) },
    'BullMQ workers started',
  );
  return all;
}

export function getPersistQueueEvents(): QueueEvents | null {
  return queueEvents;
}

export async function closeQueues(): Promise<void> {
  for (const w of activeWorkers.splice(0)) {
    try {
      await w.close();
    } catch {
      /* shutdown path — ignore */
    }
  }
  if (queueEvents) {
    try {
      await queueEvents.close();
    } catch {
      /* ignore */
    }
    queueEvents = null;
  }
  for (const q of Object.values(queues)) {
    try {
      await q.close();
    } catch {
      /* ignore */
    }
  }
  try {
    redisConnection.disconnect();
  } catch {
    /* ignore */
  }
}

/** Queue health snapshot for /api/queues/health. */
export async function queueHealth(): Promise<{
  redis: 'ok' | 'down';
  queues: Record<string, { waiting: number; active: number; failed: number } | { error: string }>;
}> {
  const redis = (await isRedisHealthy()) ? 'ok' : 'down';
  const snapshot: Record<string, { waiting: number; active: number; failed: number } | { error: string }> = {};
  for (const [name, q] of Object.entries(queues)) {
    try {
      const [waiting, active, failed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getFailedCount(),
      ]);
      snapshot[name] = { waiting, active, failed };
    } catch (err) {
      snapshot[name] = { error: err instanceof Error ? err.message : 'unavailable' };
    }
  }
  return { redis, queues: snapshot };
}

export { redisConnection as RedisConnection };
export { redisConnection as connection };
