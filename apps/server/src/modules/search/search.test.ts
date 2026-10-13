import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSearchModule } from './search.routes';
import { attachErrorHandling } from '../../platform/http';
import { requirePrisma } from '../../test/setup';
import type { Logger } from '../../platform/logger';

const fakeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

function makeApp(userId: string) {
  const app = express();
  const requireAuth = (req: any, _res: any, next: any) => {
    req.auth = { userId, sessionId: 'sess', csrfToken: 'csrf' };
    next();
  };
  app.use('/api', createSearchModule({ db: requirePrisma(), requireAuth }));
  attachErrorHandling(app, fakeLogger);
  return app;
}

async function makeUser(displayName = 'Test User') {
  const db = requirePrisma();
  const tag = randomUUID().slice(0, 8);
  return db.user.create({
    data: {
      email: `test-${tag}@chatup.test`,
      passwordHash: 'dummy-hash',
      displayName: `${displayName} ${tag}`,
    },
  });
}

async function makeConversation(aId: string, bId: string) {
  const db = requirePrisma();
  const directKey = [aId, bId].sort().join(':');
  const conv = await db.conversation.create({ data: { directKey } });
  await db.conversationParticipant.createMany({
    data: [
      { conversationId: conv.id, userId: aId },
      { conversationId: conv.id, userId: bId },
    ],
  });
  return conv;
}

async function makeMessage(conversationId: string, senderId: string, body: string) {
  return requirePrisma().message.create({
    data: { conversationId, senderId, kind: 'TEXT', body },
  });
}

describe('GET /api/search/messages', () => {
  it('finds message bodies and returns highlighted snippet', async () => {
    const a = await makeUser('Alice');
    const b = await makeUser('Bob');
    const c = await makeConversation(a.id, b.id);
    await makeMessage(c.id, a.id, 'meeting at 3pm tomorrow');
    await makeMessage(c.id, a.id, 'lunch at noon');

    const res = await request(makeApp(a.id)).get('/api/search/messages?q=meeting');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].snippet).toContain('<mark>meeting</mark>');
  });

  it('respects the after filter', async () => {
    const a = await makeUser('Alice');
    const b = await makeUser('Bob');
    const c = await makeConversation(a.id, b.id);
    await makeMessage(c.id, a.id, 'ancient message');

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(makeApp(a.id)).get(
      `/api/search/messages?q=ancient&after=${encodeURIComponent(future)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('does not leak other users messages', async () => {
    const a = await makeUser('Alice');
    const b = await makeUser('Bob');
    const c = await makeUser('Carol');
    const conv = await makeConversation(a.id, b.id);
    await makeMessage(conv.id, a.id, 'secret meeting');

    const res = await request(makeApp(c.id)).get('/api/search/messages?q=meeting');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it('rejects queries shorter than 2 characters', async () => {
    const a = await makeUser('Alice');

    const res = await request(makeApp(a.id)).get('/api/search/messages?q=a');

    expect(res.status).toBe(422);
  });

  it('finds Arabic text', async () => {
    const a = await makeUser('Alice');
    const b = await makeUser('Bob');
    const conv = await makeConversation(a.id, b.id);
    await makeMessage(conv.id, a.id, 'رحلة باريس كانت رائعة');

    const res = await request(makeApp(a.id)).get(
      `/api/search/messages?q=${encodeURIComponent('باريس')}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].snippet).toContain('<mark>باريس</mark>');
  });
});
