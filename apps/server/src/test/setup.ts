import path from 'node:path';
import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { Redis } from 'ioredis';

// Load env for both ways of running the suite:
// - from the repo root (`vitest --project server`): CWD .env
// - from apps/server (`vitest run`): explicit repo-root .env
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env') });
dotenv.config();

/**
 * Never TRUNCATE / FLUSH the development database or Redis db 0.
 * Tests that previously shared DATABASE_URL with `npm run dev` wiped
 * seeded users, messages, and attachments on every `beforeEach`.
 */
function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '').split('/')[0] || null;
  } catch {
    return null;
  }
}

function isTestDatabase(url: string): boolean {
  const name = databaseName(url);
  return name != null && (name === 'chatup_test' || /_test$/.test(name));
}

function toTestDatabaseUrl(url: string): string {
  if (isTestDatabase(url)) return url;
  const parsed = new URL(url);
  parsed.pathname = '/chatup_test';
  return parsed.toString();
}

{
  const raw = process.env.DATABASE_URL;
  if (raw && !isTestDatabase(raw)) {
    const redirected = toTestDatabaseUrl(raw);
    console.warn(
      `[test-setup] Refusing to touch database "${databaseName(raw)}"; using "${databaseName(redirected)}" instead.`,
    );
    process.env.DATABASE_URL = redirected;
  }
}

/**
 * Shared integration-test handles. Both are OPTIONAL:
 * unit tests (e.g. media.routes.test.ts) use mocked db/storage and must pass
 * with no Postgres/Redis running, so a missing/broken connection only warns
 * and skips cleanup instead of failing the whole suite.
 */
export let prisma: PrismaClient | undefined;
export let redis: Redis | undefined;

export const isDbAvailable = () => prisma !== undefined;
export const isRedisAvailable = () => redis !== undefined;

/** Use inside integration tests that truly need Postgres. */
export function requirePrisma(): PrismaClient {
  if (!prisma) throw new Error('Postgres is not available (DATABASE_URL unset or unreachable)');
  return prisma;
}

/** Use inside integration tests that truly need Redis. */
export function requireRedis(): Redis {
  if (!redis) throw new Error('Redis is not available (REDIS_URL unset or unreachable)');
  return redis;
}

let warned = false;
function warnOnce(message: string, err: unknown) {
  if (warned) return;
  warned = true;
  console.warn(
    `[test-setup] ${message} — DB-backed cleanup disabled.`,
    err instanceof Error ? err.message : err,
  );
}

beforeAll(async () => {
  // Postgres — only the dedicated test database.
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    if (!isTestDatabase(url)) {
      throw new Error(`Refusing to connect to non-test database "${databaseName(url)}"`);
    }
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    await client.$connect();
    prisma = client;
  } catch (err) {
    await prisma?.$disconnect().catch(() => {});
    prisma = undefined;
    warnOnce('Postgres unavailable', err);
  }

  // Redis db 15 so flushdb cannot wipe the dev queue / socket adapter on db 0.
  let client: Redis | undefined;
  try {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    client = new Redis(url, {
      db: 15,
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      retryStrategy: () => null,
    });
    await client.ping();
    redis = client;
  } catch (err) {
    client?.disconnect();
    redis = undefined;
    warnOnce('Redis unavailable', err);
  }
});

afterAll(async () => {
  await prisma?.$disconnect().catch(() => {});
  redis?.disconnect();
  prisma = undefined;
  redis = undefined;
});

beforeEach(async () => {
  // Order matters — respect FKs. Skipped when Postgres is down (unit tests).
  const url = process.env.DATABASE_URL;
  if (prisma && url && isTestDatabase(url)) {
    try {
      await prisma.$executeRawUnsafe(`
                TRUNCATE TABLE
                    "MessageReceipt", "Message", "MediaAttachment",
                    "ConversationParticipant", "Conversation",
                    "Session", "User"
                RESTART IDENTITY CASCADE;
            `);
    } catch (err) {
      warnOnce('DB truncate failed', err);
    }
  }
  if (redis) {
    try {
      await redis.flushdb();
    } catch (err) {
      warnOnce('Redis flushdb failed', err);
    }
  }
});
