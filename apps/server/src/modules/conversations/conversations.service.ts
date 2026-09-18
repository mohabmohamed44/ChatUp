import { LIMITS, PREVIEW_LABELS, type ConversationSummary, type MessagePreview } from '@chatup/shared';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';

type ConversationRow = {
  id: string;
  lastActivityAt: Date;
  participants: {
    userId: string;
    user: { id: string; displayName: string };
  }[];
  lastMessage: {
    id: string;
    senderId: string;
    kind: string;
    body: string | null;
    createdAt: Date;
  } | null;
  unreadCount?: number;
};

function previewText(row: ConversationRow): string {
  const message = row.lastMessage;
  if (!message) return '';
  const kind = message.kind.toLowerCase();
  if (kind === 'image') return PREVIEW_LABELS.image;
  if (kind === 'audio') return PREVIEW_LABELS.audio;
  return message.body ?? '';
}

function toSummary(row: ConversationRow, viewerId: string): ConversationSummary {
  const lastMessage = row.lastMessage
    ? ({
        messageId: row.lastMessage.id,
        senderId: row.lastMessage.senderId,
        kind: row.lastMessage.kind.toLowerCase() as MessagePreview['kind'],
        preview: previewText(row).slice(0, 140),
        createdAt: row.lastMessage.createdAt.toISOString(),
      }) satisfies MessagePreview
    : null;
  return {
    id: row.id,
    participants: row.participants
      .filter((p) => p.userId !== viewerId)
      .map((p) => ({ id: p.user.id, displayName: p.user.displayName, avatarUrl: null })),
    lastMessage,
    unreadCount: row.unreadCount ?? 0,
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

export class ConversationsService {
  constructor(private readonly db: Db) {}

  private async loadRowsForUser(userId: string, conversationId?: string) {
    const rows = await this.db.conversation.findMany({
      where: {
        participants: { some: { userId } },
        ...(conversationId ? { id: conversationId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
      take: conversationId ? 1 : 100,
      include: {
        participants: { select: { userId: true, user: { select: { id: true, displayName: true } } } },
        lastMessage: true,
      },
    });

    return Promise.all(
      rows.map(async (row) => {
        const membership = await this.db.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: row.id, userId } },
          select: { lastReadMessage: { select: { sequence: true } } },
        });
        const lastReadSequence = membership?.lastReadMessage?.sequence ?? null;
        const unreadCount = await this.db.message.count({
          where: {
            conversationId: row.id,
            senderId: { not: userId },
            // Message ids are random UUIDs, so cursors must compare on sequence.
            ...(lastReadSequence !== null ? { sequence: { gt: lastReadSequence } } : {}),
          },
        });
        return { ...row, unreadCount };
      }),
    );
  }

  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.loadRowsForUser(userId);
    return rows.map((row) => toSummary(row, userId));
  }

  /**
   * Summary as seen by `userId`: participants exclude the viewer and
   * unreadCount is specific to them.
   */
  async summaryForUser(conversationId: string, userId: string): Promise<ConversationSummary | null> {
    const rows = await this.loadRowsForUser(userId, conversationId);
    const row = rows[0];
    return row ? toSummary(row, userId) : null;
  }

  async startDirect(userId: string, otherUserId: string): Promise<ConversationSummary> {
    if (userId === otherUserId) {
      throw Errors.badRequest('Cannot start a conversation with yourself');
    }
    const other = await this.db.user.findUnique({ where: { id: otherUserId } });
    if (!other) {
      throw Errors.notFound('User');
    }
    const directKey = [userId, otherUserId].sort().join(':');
    const existing = await this.db.conversation.findUnique({
      where: { directKey },
      include: {
        participants: { select: { userId: true, user: { select: { id: true, displayName: true } } } },
        lastMessage: true,
      },
    });
    if (existing) {
      return toSummary({ ...existing, unreadCount: 0 }, userId);
    }
    const created = await this.db.conversation.create({
      data: {
        directKey,
        participants: {
          create: [
            { userId },
            { userId: otherUserId },
          ],
        },
      },
      include: {
        participants: { select: { userId: true, user: { select: { id: true, displayName: true } } } },
        lastMessage: true,
      },
    });
    return toSummary({ ...created, unreadCount: 0 }, userId);
  }

  async requireMembership(conversationId: string, userId: string): Promise<void> {
    const participant = await this.db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw Errors.forbidden('You are not a participant in this conversation');
    }
  }

  async participantIds(conversationId: string): Promise<string[]> {
    const rows = await this.db.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
}
