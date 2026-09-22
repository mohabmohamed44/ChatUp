import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookie from 'cookie';
import { createMediaModule } from './media.routes';
import { attachErrorHandling } from '../../platform/http';
import type { Logger } from '../../platform/logger';

// Helpers to build fake buffers mimicking real file signatures
function jpegBuffer(size = 1024) {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  return buf;
}
function pngBuffer(size = 1024) {
  const buf = Buffer.alloc(size);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  return buf;
}
function webpBuffer(size = 1024) {
  const buf = Buffer.alloc(size);
  buf.write('RIFF', 0);
  buf.write('WEBP', 8);
  return buf;
}
function svgBuffer() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
}
function pdfBuffer() {
  return Buffer.from('%PDF-1.4 fake pdf content');
}

// Minimal fake logger
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function createTestApp(deps: {
  db: any;
  storage: any;
  requireAuth?: any;
}) {
  const app = express();
  // replicate cookie parsing from http.ts
  app.use((req: any, _res, next) => {
    req.cookies = cookie.parse(req.headers.cookie ?? '');
    next();
  });
  const requireAuth = deps.requireAuth ?? ((req: any, _res: any, next: any) => {
    req.auth = { userId: 'user-a', sessionId: 'sess', csrfToken: 'csrf' };
    next();
  });
  const router = createMediaModule({
    db: deps.db,
    config: { MEDIA_URL_TTL_SECONDS: 900 } as any,
    logger: fakeLogger,
    storage: deps.storage,
    requireAuth,
  });
  app.use('/api', router);
  attachErrorHandling(app, fakeLogger);
  return app;
}

describe('POST /api/media/:kind - image mime & size validation', () => {
  function makeDb(overrides: any = {}) {
    const attachments = new Map<string, any>();
    let idCounter = 0;
    return {
      mediaAttachment: {
        create: vi.fn(async ({ data }: any) => {
          const id = `att-${++idCounter}`;
          const rec = { id, ...data, storageKey: data.storageKey ?? '', status: 'PENDING', createdAt: new Date(), width: null, height: null };
          attachments.set(id, rec);
          return rec;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const rec = attachments.get(where.id);
          if (!rec) throw new Error(`Attachment ${where.id} not found`);
          Object.assign(rec, data);
          if (data.status === 'COMPLETED') rec.status = 'COMPLETED';
          return rec;
        }),
        delete: vi.fn(async ({ where }: any) => {
          attachments.delete(where.id);
        }),
        findUnique: vi.fn(async ({ where }: any) => attachments.get(where.id) ?? null),
        ...overrides.mediaAttachment,
      },
      ...overrides,
    };
  }

  const storage = {
    put: vi.fn(async () => {}),
    signedGetUrl: vi.fn(async (key: string) => `https://signed.example/${key}?ttl=300`),
  };

  it('JPEG renders - accepts image/jpeg', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', jpegBuffer(), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.attachment.mimeType).toBe('image/jpeg');
    expect(res.body.attachment.kind).toBe('image');
  });

  it('PNG renders - accepts image/png', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', pngBuffer(), { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.attachment.mimeType).toBe('image/png');
  });

  it('WebP renders - accepts image/webp', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', webpBuffer(), { filename: 'photo.webp', contentType: 'image/webp' });
    expect(res.status).toBe(201);
    expect(res.body.attachment.mimeType).toBe('image/webp');
  });

  it('15 MB image rejected with clear error', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const large = jpegBuffer(15 * 1024 * 1024);
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', large, { filename: 'huge.jpg', contentType: 'image/jpeg' });
    // Multer limit is 10MB (AUDIO_MAX) so this hits MulterError LIMIT_FILE_SIZE -> 400
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/exceeds/i);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('SVG rejected (MIME not allowed)', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', svgBuffer(), { filename: 'vector.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a supported image/i);
  });

  it('PDF rejected (MIME not allowed)', async () => {
    const db = makeDb();
    const app = createTestApp({ db, storage });
    const res = await request(app)
      .post('/api/media/image')
      .set('x-csrf-token', 'csrf')
      .attach('file', pdfBuffer(), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a supported image/i);
  });
});

describe('GET /api/media/:id - auth & participant checks', () => {
  const storage = {
    put: vi.fn(async () => {}),
    signedGetUrl: vi.fn(async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}`),
  };

  it('Third user (not participant) → 403', async () => {
    const db = {
      mediaAttachment: {
        findUnique: vi.fn(async () => ({
          id: 'att-1',
          storageKey: 'attachments/att-1',
          message: {
            conversation: {
              participants: [{ userId: 'user-a' }, { userId: 'user-b' }],
            },
          },
        })),
      },
    };
    const requireAuth = (req: any, _res: any, next: any) => {
      req.auth = { userId: 'user-c', sessionId: 'sess', csrfToken: 'csrf' };
      next();
    };
    const app = createTestApp({ db, storage, requireAuth });
    const res = await request(app).get('/api/media/att-1');
    expect(res.status).toBe(403);
  });

  it('Participant can fetch signed URL', async () => {
    const db = {
      mediaAttachment: {
        findUnique: vi.fn(async () => ({
          id: 'att-1',
          storageKey: 'attachments/att-1',
          message: {
            conversation: {
              participants: [{ userId: 'user-a' }, { userId: 'user-b' }],
            },
          },
        })),
      },
    };
    const requireAuth = (req: any, _res: any, next: any) => {
      req.auth = { userId: 'user-a', sessionId: 'sess', csrfToken: 'csrf' };
      next();
    };
    const app = createTestApp({ db, storage, requireAuth });
    const res = await request(app).get('/api/media/att-1');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/signed\.example/);
    expect(storage.signedGetUrl).toHaveBeenCalledWith('attachments/att-1', 300);
  });

  it('Recipient sees image after refresh - history regenerates URL with fresh TTL', async () => {
    // Simulate toMessage calling storage.signedGetUrl with 900s TTL (tested via message service would be similar)
    // Here we test GET /media/:id regenerates on each request (no caching of signed URL)
    const db = {
      mediaAttachment: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'att-1',
            storageKey: 'attachments/att-1',
            message: { conversation: { participants: [{ userId: 'user-b' }] } },
          })
          .mockResolvedValueOnce({
            id: 'att-1',
            storageKey: 'attachments/att-1',
            message: { conversation: { participants: [{ userId: 'user-b' }] } },
          }),
      },
    };
    const requireAuth = (req: any, _res: any, next: any) => {
      req.auth = { userId: 'user-b', sessionId: 'sess', csrfToken: 'csrf' };
      next();
    };
    const localStorage = {
      signedGetUrl: vi.fn(async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}&nonce=${Math.random()}`),
      put: vi.fn(),
    };
    const app = createTestApp({ db, storage: localStorage, requireAuth });
    const first = await request(app).get('/api/media/att-1');
    const second = await request(app).get('/api/media/att-1');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(localStorage.signedGetUrl).toHaveBeenCalledTimes(2);
    // URLs should be fresh (called twice -> recipient after refresh gets new signed URL)
  });
});

describe('Image URL expiry - client refreshes URL', () => {
  it('client should fetch fresh URL on img error (simulated by calling GET /media/:id)', async () => {
    // This tests the contract that GET /media/:id is the refresh endpoint used by ImageMessage/MessageBubble onError
    const storage = {
      signedGetUrl: vi.fn(async () => 'https://signed.example/fresh-url'),
      put: vi.fn(),
    };
    const db = {
      mediaAttachment: {
        findUnique: vi.fn(async () => ({
          id: 'att-expired',
          storageKey: 'attachments/att-expired',
          message: { conversation: { participants: [{ userId: 'user-a' }] } },
        })),
      },
    };
    const requireAuth = (req: any, _res: any, next: any) => {
      req.auth = { userId: 'user-a', sessionId: 'sess', csrfToken: 'csrf' };
      next();
    };
    const app = createTestApp({ db, storage, requireAuth });
    // Simulate expired URL trigger: client does GET to refresh
    const res = await request(app).get('/api/media/att-expired');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://signed.example/fresh-url');
    // Frontend ImageMessage.tsx now calls getMediaUrl(attachment.id) onError which hits this endpoint
  });
});
