import {
  CONVERSATION_EVENTS,
  MESSAGE_EVENTS,
  SOCKET_ROOMS,
  type Attachment,
  type Message,
  type MessageDeliveryStatus,
  type SendMessageInput,
} from '@chatup/shared';
import type { Db, Tx } from '../../platform/db';
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
  editedAt: Date | null;
  deletedAt: Date | null;
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
  db: Tx,
  storage: StorageService,
  config: { MEDIA_URL_TTL_SECONDS: number },
  row: MessageRow,
  viewerId: string,
): Promise<Message> {
  const isDeleted = row.deletedAt !== null;

  let attachment: Attachment | null = null;
  if (!isDeleted && row.attachment) {
    attachment = {
      id: row.attachment.id,
      kind: row.attachment.kind.toLowerCase() as Attachment['kind'],
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

  const receiptTimes = await computeReceiptTimes(db, row, viewerId);

  return {
    id: row.id,
    sequence: row.sequence.toString(),
    conversationId: row.conversationId,
    senderId: row.senderId,
    kind: row.kind.toLowerCase() as Message['kind'],
    body: isDeleted ? null : row.body,
    attachment,
    status: await computeStatus(db, row, viewerId),
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deletedAt: isDeleted ? row.deletedAt!.toISOString() : null,
    playedAt: (await computePlayedAt(db, row, viewerId))?.toISOString() ?? null,
    deliveredAt: receiptTimes.deliveredAt?.toISOString() ?? null,
    readAt: receiptTimes.readAt?.toISOString() ?? null,
  };
}

async function computeStatus(
  db: Tx,
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

/**
 * Voice played-at is role-specific:
 * - Sender: when any recipient first listened (message-info modal).
 * - Recipient: when this viewer listened (unplayed mic badge).
 * Deleted messages never report played state — their content is masked.
 */
async function computePlayedAt(
  db: Tx,
  row: MessageRow,
  viewerId: string,
): Promise<Date | null> {
  if (row.kind.toLowerCase() !== 'audio') return null;
  if (row.deletedAt !== null) return null;

  if (row.senderId === viewerId) {
    const receipt = await db.messageReceipt.findFirst({
      where: { messageId: row.id, playedAt: { not: null } },
      select: { playedAt: true },
    });
    return receipt?.playedAt ?? null;
  }

  const receipt = await db.messageReceipt.findUnique({
    where: { messageId_userId: { messageId: row.id, userId: viewerId } },
    select: { playedAt: true },
  });
  return receipt?.playedAt ?? null;
}

/**
 * Delivery/read timestamps for the message-info view. Sender-visible only;
 * recipients and deleted messages report null (their content is masked).
 * One query for both stamps; deliveredAt/readAt stamping logic is untouched.
 */
async function computeReceiptTimes(
  db: Tx,
  row: MessageRow,
  viewerId: string,
): Promise<{ deliveredAt: Date | null; readAt: Date | null }> {
  if (row.senderId !== viewerId) return { deliveredAt: null, readAt: null };
  if (row.deletedAt !== null) return { deliveredAt: null, readAt: null };

  const receipt = await db.messageReceipt.findFirst({
    where: { messageId: row.id },
    select: { deliveredAt: true, readAt: true },
  });
  return {
    deliveredAt: receipt?.deliveredAt ?? null,
    readAt: receipt?.readAt ?? null,
  };
}

/** True when Prisma rejected a write because a unique constraint was violated. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

export class MessagesService {
  constructor(
    private readonly db: Db,
    private readonly io: ChatIo,
    private readonly storage: StorageService,
    private readonly config: { MEDIA_URL_TTL_SECONDS: number },
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  async send(input: SendMessageInput, senderId: string): Promise<Message> {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(input.conversationId, senderId);

    // The idempotency lookup, attachment validation, insert and the
    // conversation's last-message pointer must land together: if the update
    // failed after the insert, the message would be permanently invisible in
    // the conversation list. One transaction keeps the write set atomic.
    let message: MessageRow;
    try {
      message = await this.db.$transaction(async (tx) => {
        const existing = await tx.message.findUnique({
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
          return existing;
        }

        let attachmentId: string | null = null;
        if (input.attachmentId) {
          const attachment = await tx.mediaAttachment.findUnique({
            where: { id: input.attachmentId },
          });
          if (
            !attachment ||
            attachment.ownerId !== senderId ||
            attachment.status !== 'COMPLETED'
          ) {
            throw Errors.badRequest('Attachment not found or not ready');
          }
          attachmentId = attachment.id;
        }

        const created = await tx.message.create({
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

        await tx.conversation.update({
          where: { id: input.conversationId },
          data: { lastMessageId: created.id, lastActivityAt: created.createdAt },
        });

        return created;
      });
    } catch (err) {
      // A concurrent retry with the same clientId can slip past the in-transaction
      // lookup and lose the unique-constraint race. Resolve it to the winner's row
      // so sends stay idempotent.
      if (isUniqueViolation(err)) {
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
      }
      throw err;
    }

    const payload = await toMessage(
      this.db,
      this.storage,
      this.config,
      message,
      senderId,
    );

    this.io
      .to(SOCKET_ROOMS.conversation(input.conversationId))
      .emit(MESSAGE_EVENTS.new, { message: payload });

    await this.emitConversationUpdate(input.conversationId);

    return payload;
  }

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------

  private static readonly EDIT_WINDOW_MS = 15 * 60 * 1000;

  async editMessage(
    messageId: string,
    userId: string,
    newBody: string,
  ): Promise<Message> {
    const message = await this.db.message.findUnique({
      where: { id: messageId },
      include: { attachment: true },
    });

    if (!message) throw Errors.notFound('Message');
    if (message.senderId !== userId) {
      throw Errors.forbidden('You can only edit your own messages');
    }
    if (message.deletedAt) {
      throw Errors.badRequest('Cannot edit a deleted message');
    }
    if (message.kind !== 'TEXT') {
      throw Errors.badRequest('Only text messages can be edited');
    }

    const ageMs = Date.now() - message.createdAt.getTime();
    if (ageMs > MessagesService.EDIT_WINDOW_MS) {
      throw Errors.badRequest('Messages can only be edited within 15 minutes');
    }

    const updated = await this.db.message.update({
      where: { id: messageId },
      data: { body: newBody, editedAt: new Date() },
      include: { attachment: true },
    });

    const payload = await toMessage(
      this.db,
      this.storage,
      this.config,
      updated,
      userId,
    );

    // Notify the conversation participants in real time.
    this.io
      .to(SOCKET_ROOMS.conversation(message.conversationId))
      .emit(MESSAGE_EVENTS.edited, { message: payload });

    // If the edited message is the last one, the conversation-list preview
    // must reflect the new text. Emit an updated summary to every participant.
    await this.emitConversationUpdate(message.conversationId);

    return payload;
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async deleteMessage(messageId: string, userId: string): Promise<Message> {
    const message = await this.db.message.findUnique({
      where: { id: messageId },
      include: { attachment: true },
    });

    if (!message) throw Errors.notFound('Message');
    if (message.senderId !== userId) {
      throw Errors.forbidden('You can only delete your own messages');
    }
    if (message.deletedAt) {
      // Idempotent: return existing state
      return toMessage(this.db, this.storage, this.config, message, userId);
    }

    const updated = await this.db.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        body: null,
        attachmentId: null,
      },
      include: { attachment: true },
    });

    const payload = await toMessage(
      this.db,
      this.storage,
      this.config,
      updated,
      userId,
    );

    this.io
      .to(SOCKET_ROOMS.conversation(message.conversationId))
      .emit(MESSAGE_EVENTS.deleted, { message: payload });

    // If the deleted message was the last one, the conversation preview must
    // be refreshed for every participant.
    await this.emitConversationUpdate(message.conversationId);

    return payload;
  }

  // ---------------------------------------------------------------------------
  // Played
  // ---------------------------------------------------------------------------

  async markPlayed(
    conversationId: string,
    userId: string,
    messageId: string,
  ): Promise<void> {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    // Played is only meaningful for messages from OTHER participants.
    // Enforced against the database, not the caller payload.
    const message = await this.db.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, kind: true },
    });

    if (!message) throw Errors.notFound('Message');
    if (message.conversationId !== conversationId) {
      throw Errors.badRequest('Message does not belong to this conversation');
    }
    if (message.senderId === userId) {
      throw Errors.badRequest('Cannot mark your own message as played');
    }
    if (message.kind !== 'AUDIO') {
      throw Errors.badRequest('Only voice messages can be marked as played');
    }

    // A delivered/read receipt often already exists. Prisma skips `undefined`
    // fields, so we must set playedAt on first listen even when the row is old.
    const existing = await this.db.messageReceipt.findUnique({
      where: { messageId_userId: { messageId, userId } },
      select: { playedAt: true },
    });
    if (existing?.playedAt) return;

    const now = new Date();
    await this.db.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, playedAt: now },
      update: { playedAt: now },
    });

    this.io
      .to(SOCKET_ROOMS.conversation(conversationId))
      .emit(MESSAGE_EVENTS.played, {
        messageId,
        userId,
        playedAt: now.toISOString(),
      });
  }

  // ---------------------------------------------------------------------------
  // Conversation list update helpers
  // ---------------------------------------------------------------------------

  /**
   * Summaries are viewer-specific (participants exclude the viewer, unreadCount
   * is theirs), so every participant receives their own computed summary.
   */
  private async emitConversationUpdate(conversationId: string): Promise<void> {
    const svc = new ConversationsService(this.db);
    const participantIds = await svc.participantIds(conversationId);
    await Promise.all(
      participantIds.map((participantId) =>
        this.emitConversationUpdateFor(conversationId, participantId),
      ),
    );
  }

  private async emitConversationUpdateFor(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const svc = new ConversationsService(this.db);
      const summary = await svc.summaryForUser(conversationId, userId);
      if (!summary) return;
      this.io
        .to(SOCKET_ROOMS.user(userId))
        .emit(CONVERSATION_EVENTS.updated, { conversation: summary });
    } catch (err) {
      this.logger.warn(
        { err, conversationId, userId },
        'Failed to emit conversation update',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // History / sync
  // ---------------------------------------------------------------------------

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
        ...(opts.before ? { sequence: { lt: BigInt(opts.before) } } : {}),
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
      nextCursor: hasMore && last ? last.sequence.toString() : null,
    };
  }

  async sync(
    conversationId: string,
    userId: string,
    afterSequence: string | null,
    limit: number,
  ) {
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

  // ---------------------------------------------------------------------------
  // Receipts
  // ---------------------------------------------------------------------------

  async markDelivered(
    conversationId: string,
    userId: string,
    messageIds: string[],
  ) {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    // Receipts are only meaningful for messages from OTHER participants of this
    // conversation. Enforced against the database rather than trusting the
    // caller's payload, so a malformed or forged socket event can never create
    // a self-receipt or a cross-conversation one. The guard lookup and the
    // upserts share one transaction so they observe the same snapshot, and every
    // receipt is stamped with the same timestamp.
    const deliveredIds = await this.db.$transaction(async (tx) => {
      const deliverable = await tx.message.findMany({
        where: {
          id: { in: messageIds },
          conversationId,
          senderId: { not: userId },
        },
        select: { id: true },
      });
      if (deliverable.length === 0) return [];

      const ids = deliverable.map((message) => message.id);
      const now = new Date();
      for (const messageId of ids) {
        await tx.messageReceipt.upsert({
          where: { messageId_userId: { messageId, userId } },
          create: { messageId, userId, deliveredAt: now },
          update: { deliveredAt: now },
        });
      }
      return ids;
    });

    if (deliveredIds.length === 0) return;

    await this.emitStatus(conversationId, deliveredIds, 'delivered');
  }

  async markRead(conversationId: string, userId: string, upToMessageId?: string) {
    const conversations = new ConversationsService(this.db);
    await conversations.requireMembership(conversationId, userId);

    // Resolving the target, stamping every unread receipt and advancing the
    // participant's read marker is one unit: a partial read would either leave
    // messages unread forever or move lastReadMessageId past receipts that were
    // never written. Everything through the marker update runs in one
    // transaction; only side effects (socket emits) happen after commit.
    const result = await this.db.$transaction(async (tx) => {
      let targetId = upToMessageId;
      if (!targetId) {
        const latest = await tx.message.findFirst({
          where: { conversationId },
          orderBy: { sequence: 'desc' },
          select: { id: true },
        });
        targetId = latest?.id;
      }
      if (!targetId) return null;

      const target = await tx.message.findUnique({ where: { id: targetId } });
      if (!target || target.conversationId !== conversationId) {
        throw Errors.badRequest('Message does not belong to this conversation');
      }

      const unread = await tx.message.findMany({
        where: {
          conversationId,
          senderId: { not: userId },
          sequence: { lte: target.sequence },
          receipts: { none: { userId, readAt: { not: null } } },
        },
        select: { id: true },
      });

      const now = new Date();
      for (const message of unread) {
        await tx.messageReceipt.upsert({
          where: { messageId_userId: { messageId: message.id, userId } },
          create: { messageId: message.id, userId, deliveredAt: now, readAt: now },
          update: { readAt: now },
        });
      }

      await tx.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadMessageId: targetId },
      });

      return { unreadIds: unread.map((message) => message.id) };
    });

    if (!result) return;

    if (result.unreadIds.length > 0) {
      await this.emitStatus(conversationId, result.unreadIds, 'read');
    }

    // Push the reader's own summary so their unread badge clears immediately.
    await this.emitConversationUpdateFor(conversationId, userId);
  }

  private async emitStatus(
    conversationId: string,
    messageIds: string[],
    status: 'delivered' | 'read',
  ): Promise<void> {
    this.io
      .to(SOCKET_ROOMS.conversation(conversationId))
      .emit(MESSAGE_EVENTS.status, {
        conversationId,
        messageIds,
        status,
        at: new Date().toISOString(),
      });
  }
}