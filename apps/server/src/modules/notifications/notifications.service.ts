import type { PushAckStatus } from '@chatup/shared';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';

export interface RecordPushAckInput {
  messageId: string;
  userId: string;
  status: PushAckStatus;
}

/**
 * Stores push-notification acknowledgements beaconed by the service worker.
 * Observational only: acks never drive ticks/read state (MessageReceipt owns
 * that). Upsert makes retries and duplicate beacons idempotent.
 */
export class NotificationsService {
  constructor(private readonly db: Db) {}

  async recordPushAck(input: RecordPushAckInput) {
    const message = await this.db.message.findUnique({
      where: { id: input.messageId },
      select: { id: true, conversationId: true },
    });
    if (!message) throw Errors.notFound('Message');

    // Same 404 for non-participants so ack probing can't enumerate messages.
    const participant = await this.db.conversationParticipant.findUnique({
      where: {
        conversationId_userId: { conversationId: message.conversationId, userId: input.userId },
      },
      select: { userId: true },
    });
    if (!participant) throw Errors.notFound('Message');

    return this.db.pushAck.upsert({
      where: {
        messageId_userId_status: {
          messageId: input.messageId,
          userId: input.userId,
          status: input.status,
        },
      },
      create: { messageId: input.messageId, userId: input.userId, status: input.status },
      update: { createdAt: new Date() },
    });
  }
}
