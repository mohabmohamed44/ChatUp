import { isRedisHealthy, redisConnection } from './queue';
import { logger } from './logger';

/**
 * Per-user message-send rate limiting (fixed window).
 *
 * Deliberately NOT per-IP: the global 300 req/min/IP limiter was removed
 * because per-IP counting throttles everyone behind a shared egress/NAT
 * (observed under k6 load from a shared IP). Message sends are always
 * authenticated, so the correct key is the user id — 100 load-test VUs (one
 * user each) stay far below this limit; one user hammering the socket does
 * not.
 *
 * Redis-backed so the cap is enforced across instances; when Redis is down
 * the in-memory fallback keeps a per-instance cap. Messaging degrades, it
 * does not stop (same philosophy as the queue layer).
 */
export const MESSAGE_RATE_LIMIT = {
  MAX_PER_WINDOW: 15,
  WINDOW_MS: 10_000,
} as const;

const REDIS_PREFIX = 'chatup:rl:msg';

// In-memory fallback: exactly one entry per user (lazily reset each window),
// so the map is bounded by the number of users seen — no TTL sweep needed.
const memoryWindows = new Map<string, { window: number; count: number }>();

export function memoryCheck(userId: string, now: number = Date.now()): boolean {
  const window = Math.floor(now / MESSAGE_RATE_LIMIT.WINDOW_MS);
  const state = memoryWindows.get(userId);
  if (!state || state.window !== window) {
    memoryWindows.set(userId, { window, count: 1 });
    return true;
  }
  state.count += 1;
  return state.count <= MESSAGE_RATE_LIMIT.MAX_PER_WINDOW;
}

async function redisCheck(userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / MESSAGE_RATE_LIMIT.WINDOW_MS);
  const key = `${REDIS_PREFIX}:${userId}:${window}`;
  const count = await redisConnection.incr(key);
  if (count === 1) {
    // +1s slack so the key always outlives its window.
    await redisConnection.expire(key, Math.ceil(MESSAGE_RATE_LIMIT.WINDOW_MS / 1000) + 1);
  }
  return count <= MESSAGE_RATE_LIMIT.MAX_PER_WINDOW;
}

export async function allowMessageSend(userId: string): Promise<boolean> {
  if (await isRedisHealthy()) {
    try {
      return await redisCheck(userId);
    } catch (err) {
      logger.warn(
        { err, userId },
        'Message rate limit: Redis check failed, using in-memory fallback',
      );
    }
  }
  return memoryCheck(userId);
}
