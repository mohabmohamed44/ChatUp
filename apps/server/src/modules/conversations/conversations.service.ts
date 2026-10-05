import { LIMITS, PREVIEW_LABELS, type ConversationSummary, type MessagePreview } from '@chatup/shared';
import type { AppConfig } from '../../platform/config';
import type { Db } from '../../platform/db';
import { Errors } from '../../platform/errors';
import type { StorageService } from '../../platform/storage';

type ConversationRow = {
  id: string;
  lastActivityAt: Date;
  participants: {
    userId: string;
    user: { id: string; displayName: string; avatarMediaId: string | null };
  }[];
  lastMessage: {
    id: string;
    senderId: string;
    kind: string;
    body: string | null;
    createdAt: Date;
  } | null;
  unreadCount?: number;
  lastReadMessageId?: string | null;
};

function previewText(row: ConversationRow): string {
  const message = row.lastMessage;
  if (!message) return '';
  const kind = message.kind.toLowerCase();
  if (kind === 'image') return PREVIEW_LABELS.image;
  if (kind === 'audio') return PREVIEW_LABELS.audio;
  return message.body ?? '';
}

async function toSummary(
  row: ConversationRow,
  viewerId: string,
  storage: StorageService,
  ttlSeconds: number,
): Promise<ConversationSummary> {
  const lastMessage = row.lastMessage
    ? ({
        messageId: row.lastMessage.id,
        senderId: row.lastMessage.senderId,
        kind: row.lastMessage.kind.toLowerCase() as MessagePreview['kind'],
        preview: previewText(row).slice(0, 140),
        createdAt: row.lastMessage.createdAt.toISOString(),
      }) satisfies MessagePreview
    : null;
  const participants = await Promise.all(
    row.participants
      .filter((p) => p.userId !== viewerId)
      .map(async (p) => ({
        id: p.user.id,
        displayName: p.user.displayName,
        avatarUrl: p.user.avatarMediaId
          ? await storage.signedGetUrl(`attachments/${p.user.avatarMediaId}`, ttlSeconds)
          : null,
      })),
  );
  return {
    id: row.id,
    participants,
    lastMessage,
    unreadCount: row.unreadCount ?? 0,
    lastActivityAt: row.lastActivityAt.toISOString(),
    lastReadMessageId: row.lastReadMessageId ?? null,
  };
}

const PARTICIPANT_SELECT = {
  userId: true,
  user: { select: { id: true, displayName: true, avatarMediaId: true } },
} as const;

export class ConversationsService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageService,
    private readonly config: Pick<AppConfig, 'MEDIA_URL_TTL_SECONDS'>,
  ) {}

  private ttlSeconds(): number {
    return this.config.MEDIA_URL_TTL_SECONDS;
  }

  private async loadRowsForUser(userId: string, conversationId?: string) {
    const rows = await this.db.conversation.findMany({
      where: {
        participants: { some: { userId } },
        ...(conversationId ? { id: conversationId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
      take: conversationId ? 1 : 100,
      include: {
        participants: { select: PARTICIPANT_SELECT },
        lastMessage: true,
      },
    });

    // Defensive fallback: if the lastMessage relation is null (stale NULL
    // lastMessageId pointer left by a cleanup script), fetch the newest
    // message so the list still shows a preview. Only runs for rows that
    // actually need it — rows with a resolved lastMessage skip the query.
    // NOTE: the task's suggested guard
    // (`if (row.lastMessage || row.lastMessageId === null) return row`)
    // is inverted — it would skip exactly the broken rows (pointer NULL).
    // The correct check is below: repair whenever lastMessage is null.
    const repaired = await Promise.all(
      rows.map(async (row) => {
        if (row.lastMessage) return row;
        const latest = await this.db.message.findFirst({
          where: { conversationId: row.id },
          orderBy: { sequence: 'desc' },
        });
        if (!latest) return row;
        return { ...row, lastMessage: latest };
      }),
    );

    return Promise.all(
      repaired.map(async (row) => {
        const membership = await this.db.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId: row.id, userId } },
          select: { lastReadMessage: { select: { sequence: true } }, lastReadMessageId: true },
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
        return { ...row, unreadCount, lastReadMessageId: membership?.lastReadMessageId ?? null };
      }),
    );
  }

  async listForUser(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.loadRowsForUser(userId);
    return Promise.all(rows.map((row) => toSummary(row, userId, this.storage, this.ttlSeconds())));
  }

  /**
   * Summary as seen by `userId`: participants exclude the viewer and
   * unreadCount is specific to them.
   */
  async summaryForUser(conversationId: string, userId: string): Promise<ConversationSummary | null> {
    const rows = await this.loadRowsForUser(userId, conversationId);
    const row = rows[0];
    return row ? toSummary(row, userId, this.storage, this.ttlSeconds()) : null;
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
        participants: { select: PARTICIPANT_SELECT },
        lastMessage: true,
      },
    });
    if (existing) {
      return toSummary({ ...existing, unreadCount: 0 }, userId, this.storage, this.ttlSeconds());
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
        participants: { select: PARTICIPANT_SELECT },
        lastMessage: true,
      },
    });
    return toSummary({ ...created, unreadCount: 0 }, userId, this.storage, this.ttlSeconds());
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
