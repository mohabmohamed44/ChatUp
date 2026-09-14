import {
  LIMITS,
  MESSAGE_EVENTS,
  SOCKET_ROOMS,
  type Attachment,
  type Message,
  type MessageDeliveryStatus,
  type SendMessageInput,
} from '@chatup/shared';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';
import type { Logger } from '../../platform/logger';
import type { StorageService } from '../../platform/storage';
import type { ChatIo } from '../../realtime/io';
import { ConversationsService } from '../conversations/conversations.service';

type MessageRow = {
  id: string;
  sequence: bigint;
  conversationId: string;
  senderId: string;
  kind: string;
  body: string | null;
  clientId: string | null;
  createdAt: Date;
  attachment: {
    id: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  } | null;
};

export async function toMessage(
  db: Db,
  storage: StorageService,
  config: { MEDIA_URL_TTL_SECONDS: number },
  row: MessageRow,
  viewerId: string,
): Promise<Message> {
  let attachment: Attachment | null = null;
  if (row.attachment) {
    attachment = {
      id: row.attachment.id,
      kind: row.attachment.kind as Attachment['kind'],
      mimeType: row.attachment.mimeType,
      sizeBytes: row.attachment.sizeBytes,
      width: row.attachment.width,
      height: row.attachment.height,
      durationMs: row.attachment.durationMs,
      url: await storage.signedGetUrl(
        `attachments/${row.attachment.id}`,
        config.MEDIA_URL_TTL_SECONDS,
      ),
    };
  }
  return {
    id: row.id,
    sequence: row.sequence.toString(),
    conversationId: row.conversationId,
    senderId: row.senderId,
    kind: row.kind as Message['kind'],
    body: row.body,
    attachment,
    status: await computeStatus(db, row, viewerId),
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function computeStatus(
  db: Db,
  row: MessageRow,
  viewerId: string,
): Promise<MessageDeliveryStatus> {
  if (row.senderId === viewerId) {
    const recipientRead = await db.messageReceipt.findFirst({
      where: { messageId: row.id, readAt: { not: null } },
      select: { readAt: true },
    });
    if (recipientRead) return 'read';
    const recipientDelivered = await db.messageReceipt.findFirst({
      where: { messageId: row.id, deliveredAt: { not: null } },
      select: { deliveredAt: true },
    });
    if (recipientDelivered) return 'delivered';
    return 'sent';
  }
  return 'sent';
}

export class MessagesService {
  constructor(
    private readonly db: Db,
    private readonly io: ChatIo,
    private readonly storage: StorageService,
    private readonly config: { MEDIA_URL_TTL_SECONDS: number },
    private readonly logger: Logger,
  ) {}

  async send(input: SendMessageInput, senderId: string): Promise<Message> {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(input.conversationId, senderId);

    const existing = await this.db.message.findUnique({
      where: {
        conversationId_senderId_clientId: {
          conversationId: input.conversationId,
          senderId,
          clientId: input.clientId,
        },
      },
      include: { attachment: true },
    });
    if (existing) {
      return toMessage(this.db, this.storage, this.config, existing, senderId);
    }

    let attachmentId: string | null = null;
    if (input.attachmentId) {
      const attachment = await this.db.mediaAttachment.findUnique({
        where: { id: input.attachmentId },
      });
      if (!attachment || attachment.ownerId !== senderId || attachment.status !== 'COMPLETED') {
        throw Errors.badRequest('Attachment not found or not ready');
      }
      attachmentId = attachment.id;
    }

    const message = await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        senderId,
        clientId: input.clientId,
        kind: input.kind.toUpperCase() as 'TEXT' | 'IMAGE' | 'AUDIO',
        body: input.body ?? null,
        attachmentId,
      },
      include: { attachment: true },
    });

    await this.db.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageId: message.id, lastActivityAt: message.createdAt },
    });

    const payload = await toMessage(this.db, this.storage, this.config, message, senderId);

    this.io
      .to(SOCKET_ROOMS.conversation(input.conversationId))
      .emit(MESSAGE_EVENTS.new, { message: payload });

    await this.emitConversationUpdate(input.conversationId, senderId);

    return payload;
  }

  private async emitConversationUpdate(conversationId: string, senderId: string): Promise<void> {
    try {
      const svc = new ConversationsService(this.db);
      const list = await svc.listForUser(senderId);
      const summary = list.find((c) => c.id === conversationId);
      if (!summary) return;
      const participantIds = await svc.participantIds(conversationId);
      for (const participantId of participantIds) {
        this.io
          .to(SOCKET_ROOMS.user(participantId))
          .emit('conversation:updated', { conversation: summary });
      }
    } catch (err) {
      this.logger.warn({ err, conversationId }, 'Failed to emit conversation update');
    }
  }

  async history(
    conversationId: string,
    userId: string,
    opts: { before?: string; limit: number },
  ) {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    const rows = await this.db.message.findMany({
      where: {
        conversationId,
        ...(opts.before ? { id: { lt: opts.before } } : {}),
      },
      orderBy: [{ sequence: 'desc' }],
      take: opts.limit + 1,
      include: { attachment: true },
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const items = await Promise.all(
      page.map((row) => toMessage(this.db, this.storage, this.config, row, userId)),
    );
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async sync(conversationId: string, userId: string, afterSequence: string | null, limit: number) {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    const rows = await this.db.message.findMany({
      where: {
        conversationId,
        ...(afterSequence ? { sequence: { gt: BigInt(afterSequence) } } : {}),
      },
      orderBy: [{ sequence: 'asc' }],
      take: limit,
      include: { attachment: true },
    });

    const items = await Promise.all(
      rows.map((row) => toMessage(this.db, this.storage, this.config, row, userId)),
    );
    return {
      items,
      nextCursor: rows.length === limit ? rows.at(-1)!.sequence.toString() : null,
    };
  }

  async markDelivered(conversationId: string, userId: string, messageIds: string[]) {
    await Promise.all(
      messageIds.map((messageId) =>
        this.db.messageReceipt.upsert({
          where: { messageId_userId: { messageId, userId } },
          create: { messageId, userId, deliveredAt: new Date() },
          update: { deliveredAt: new Date() },
        }),
      ),
    );
    await this.emitStatus(conversationId, messageIds, 'delivered');
  }

  async markRead(conversationId: string, userId: string, upToMessageId?: string) {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    let targetId = upToMessageId;
    if (!targetId) {
      const latest = await this.db.message.findFirst({
        where: { conversationId },
        orderBy: { sequence: 'desc' },
        select: { id: true },
      });
      targetId = latest?.id;
    }
    if (!targetId) return;

    const target = await this.db.message.findUnique({ where: { id: targetId } });
    if (!target || target.conversationId !== conversationId) {
      throw Errors.badRequest('Message does not belong to this conversation');
    }

    const unread = await this.db.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        sequence: { lte: target.sequence },
        receipts: { none: { userId, readAt: { not: null } } },
      },
      select: { id: true },
    });

    const now = new Date();
    await Promise.all(
      unread.map((m) =>
        this.db.messageReceipt.upsert({
          where: { messageId_userId: { messageId: m.id, userId } },
          create: { messageId: m.id, userId, deliveredAt: now, readAt: now },
          update: { readAt: now },
        }),
      ),
    );

    await this.db.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadMessageId: targetId },
    });

    if (unread.length > 0) {
      await this.emitStatus(
        conversationId,
        unread.map((m) => m.id),
        'read',
      );
    }
  }

  private async emitStatus(
    conversationId: string,
    messageIds: string[],
    status: 'delivered' | 'read',
  ): Promise<void> {
    this.io.to(SOCKET_ROOMS.conversation(conversationId)).emit(MESSAGE_EVENTS.status, {
      conversationId,
      messageIds,
      status,
      at: new Date().toISOString(),
    });
  }
}
