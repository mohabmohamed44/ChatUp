import type { Db } from '../../platform/db';
import type { searchMessageInput, SearchConversationsInput } from '@chatup/shared';

interface SearchRow {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  snippet: string;
  createdAt: Date;
  sequence: bigint;
  rank: number;
}

export async function searchMessages(db: Db, userId: string, input: searchMessageInput) {
  const { q, conversationId, partnerId, after, before, cursor, limit } = input;

  const params: unknown[] = [userId, q];
  const conditions: string[] = [
    `EXISTS (
       SELECT 1 FROM "ConversationParticipant" cp
       WHERE cp."conversationId" = m."conversationId"
         AND cp."userId" = $1
     )`,
    `m."deletedAt" IS NULL`,
    `m.kind = 'TEXT'`,
    `m."searchVector" @@ websearch_to_tsquery('simple', $2)`,
  ];

  if (conversationId) {
    params.push(conversationId);
    conditions.push(`m."conversationId" = $${params.length}`);
  }

  if (partnerId) {
    params.push(partnerId);
    conditions.push(`EXISTS (
      SELECT 1 FROM "ConversationParticipant" cp2
      WHERE cp2."conversationId" = m."conversationId"
        AND cp2."userId" = $${params.length}
    )`);
  }

  if (after) {
    params.push(after);
    conditions.push(`m."createdAt" >= $${params.length}`);
  }

  if (before) {
    params.push(before);
    conditions.push(`m."createdAt" <= $${params.length}`);
  }

  if (cursor) {
    params.push(BigInt(cursor));
    conditions.push(`m."sequence" < $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;

  const rows = await db.$queryRawUnsafe<SearchRow[]>(
    `
    SELECT
      m.id,
      m."conversationId",
      m."senderId",
      u."displayName" AS "senderName",
      m.body,
      ts_headline(
        'simple',
        m.body,
        websearch_to_tsquery('simple', $2),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=15, HighlightAll=false'
      ) AS snippet,
      m."createdAt",
      m."sequence",
      ts_rank(m."searchVector", websearch_to_tsquery('simple', $2)) AS rank
    FROM "Message" m
    JOIN "User" u ON u.id = m."senderId"
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank DESC, m."sequence" DESC
    LIMIT $${limitIdx}
    `,
    ...params,
  );

  return {
    results: rows.map((r: SearchRow) => ({
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      senderName: r.senderName,
      body: r.body,
      snippet: r.snippet,
      createdAt: r.createdAt.toISOString(),
      sequence: r.sequence.toString(),
    })),
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.sequence.toString() ?? null) : null,
  };
}

export async function searchConversations(db: Db, userId: string, input: SearchConversationsInput) {
  const { q, lastActiveAfter, lastActiveBefore, limit } = input;

  const params: unknown[] = [userId];
  const conditions: string[] = [
    `EXISTS (
       SELECT 1 FROM "ConversationParticipant" cp
       WHERE cp."conversationId" = c.id AND cp."userId" = $1
     )`,
  ];

  if (lastActiveAfter) {
    params.push(lastActiveAfter);
    conditions.push(`c."lastActivityAt" >= $${params.length}`);
  }

  if (lastActiveBefore) {
    params.push(lastActiveBefore);
    conditions.push(`c."lastActivityAt" <= $${params.length}`);
  }

  let messageFilter = '';
  if (q) {
    params.push(q);
    messageFilter = `AND EXISTS (
      SELECT 1 FROM "Message" m
      WHERE m."conversationId" = c.id
        AND m."searchVector" @@ websearch_to_tsquery('simple', $${params.length})
        AND m."deletedAt" IS NULL
    )`;
  }

  params.push(limit);
  const limitIdx = params.length;

  return db.$queryRawUnsafe<
    Array<{ id: string; lastActivityAt: Date; lastMessageId: string | null }>
  >(
    `
    SELECT c.id, c."lastActivityAt", c."lastMessageId"
    FROM "Conversation" c
    WHERE ${conditions.join(' AND ')}
    ${messageFilter}
    ORDER BY c."lastActivityAt" DESC
    LIMIT $${limitIdx}
    `,
    ...params,
  );
}
