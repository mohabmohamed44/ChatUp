import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    message: { findUnique: vi.fn() },
    conversationParticipant: { findUnique: vi.fn() },
    pushAck: { upsert: vi.fn() },
    ...overrides,
  } as any;
}

describe('NotificationsService.recordPushAck', () => {
  it('upserts a displayed ack for a participant', async () => {
    const db = makeDb();
    db.message.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1' });
    db.conversationParticipant.findUnique.mockResolvedValue({ userId: 'u1' });
    db.pushAck.upsert.mockResolvedValue({ messageId: 'm1', status: 'displayed' });

    const svc = new NotificationsService(db);
    await svc.recordPushAck({ messageId: 'm1', userId: 'u1', status: 'displayed' });

    expect(db.pushAck.upsert).toHaveBeenCalledWith({
      where: { messageId_userId_status: { messageId: 'm1', userId: 'u1', status: 'displayed' } },
      create: { messageId: 'm1', userId: 'u1', status: 'displayed' },
      update: expect.objectContaining({ createdAt: expect.any(Date) }),
    });
  });

  it('404s for unknown messages (no existence leak)', async () => {
    const db = makeDb();
    db.message.findUnique.mockResolvedValue(null);

    const svc = new NotificationsService(db);
    await expect(
      svc.recordPushAck({ messageId: 'nope', userId: 'u1', status: 'displayed' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(db.pushAck.upsert).not.toHaveBeenCalled();
  });

  it('404s for non-participants', async () => {
    const db = makeDb();
    db.message.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1' });
    db.conversationParticipant.findUnique.mockResolvedValue(null);

    const svc = new NotificationsService(db);
    await expect(
      svc.recordPushAck({ messageId: 'm1', userId: 'stranger', status: 'clicked' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(db.pushAck.upsert).not.toHaveBeenCalled();
  });
});
