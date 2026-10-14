import { createHash } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { LIMITS } from '@chatup/shared';
import { createRealtime, type Realtime } from './io';
import type { Logger } from '../platform/logger';

// No Redis in unit tests. queue.ts builds BullMQ queues at import time, so both
// ioredis and bullmq are stubbed: the realtime module then degrades to the
// in-memory Socket.IO adapter (same as dev without Redis).
vi.mock('ioredis', () => ({
  Redis: class {
    on() {
      return this;
    }
    ping() {
      return Promise.reject(new Error('redis disabled in tests'));
    }
    duplicate() {
      const Ctor = (this as object).constructor as new () => object;
      return new Ctor();
    }
    disconnect() {}
    quit() {
      return Promise.resolve('OK');
    }
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    close() {
      return Promise.resolve();
    }
  },
  Worker: class {},
  QueueEvents: class {},
}));

const COOKIE_TOKEN = 'cookie-token-for-tests';
const CSRF_TOKEN = 'csrf-token-for-tests';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const sessionRecord = {
  id: 'sess-1',
  userId: 'user-1',
  tokenHash: sha256(COOKIE_TOKEN),
  csrfToken: CSRF_TOKEN,
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(),
  revokedAt: null,
  fid: null,
  user: { id: 'user-1' },
};

function makeDb() {
  return {
    session: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.tokenHash === sessionRecord.tokenHash ? sessionRecord : null,
      ),
      findFirst: vi.fn(async ({ where }: any) =>
        where.csrfToken === sessionRecord.csrfToken ? sessionRecord : null,
      ),
    },
    conversationParticipant: {
      findMany: vi.fn(async () => []),
    },
  };
}

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('Socket.IO handshake auth', () => {
  let httpServer: HttpServer;
  let realtime: Realtime;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    realtime = createRealtime(httpServer, {
      config: { REDIS_URL: 'redis://127.0.0.1:1', corsOrigins: [] } as any,
      logger: fakeLogger,
      db: makeDb() as any,
      storage: {} as any,
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await realtime.presence.stop();
    realtime.io.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function connect(options: { cookie?: string; csrfToken?: string } = {}): Promise<ClientSocket> {
    const extraHeaders = options.cookie
      ? { cookie: `${LIMITS.SESSION_COOKIE_NAME}=${options.cookie}` }
      : undefined;
    const client = ioClient(url, {
      autoConnect: false,
      reconnection: false,
      transports: ['polling'],
      ...(extraHeaders ? { extraHeaders } : {}),
      auth: { csrfToken: options.csrfToken },
    });
    clients.push(client);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timed out')), 3_000);
      client.on('connect', () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      client.connect();
    });
  }

  it('accepts the session cookie (existing behavior)', async () => {
    const client = await connect({ cookie: COOKIE_TOKEN });
    expect(client.connected).toBe(true);
  });

  it('accepts the CSRF token from handshake auth without any cookie (cross-domain case)', async () => {
    const client = await connect({ csrfToken: CSRF_TOKEN });
    expect(client.connected).toBe(true);
  });

  it('rejects a wrong CSRF token with no cookie', async () => {
    await expect(connect({ csrfToken: 'wrong-token' })).rejects.toThrow('unauthorized');
  });

  it('rejects connections with no credentials at all', async () => {
    await expect(connect()).rejects.toThrow('unauthorized');
  });
});
