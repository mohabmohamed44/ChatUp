import { z } from 'zod';
import { LIMITS } from '../constants';

export const sendMessageSchema = z
  .object({
    conversationId: z.uuid(),
    clientId: z.uuid(),
    kind: z.enum(['text', 'image', 'audio']),
    body: z.string().trim().min(1).max(LIMITS.MESSAGE_MAX_LENGTH).optional(),
    attachmentId: z.uuid().optional(),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(LIMITS.RECORDING_MAX_SECONDS * 1000)
      .optional(),
  })
  .refine((m) => (m.kind === 'text' ? m.body !== undefined : m.attachmentId !== undefined), {
    message: 'Text messages require a body; media messages require an attachmentId',
  })
  .refine((m) => (m.kind === 'text' ? m.attachmentId === undefined : m.body === undefined), {
    message: 'Media messages must not include a text body',
  })
  .refine((m) => (m.kind === 'audio' ? m.durationMs !== undefined : true), {
    message: 'Audio messages require durationMs',
  });

export const readReceiptSchema = z.object({
  conversationId: z.uuid(),
  upToMessageId: z.uuid().optional(),
});

export const messageSyncSchema = z.object({
  conversationId: z.uuid(),
  afterSequence: z.string().regex(/^\d+$/).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.HISTORY_PAGE_MAX).optional(),
});

export const messageHistoryQuerySchema = z.object({
  before: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.HISTORY_PAGE_MAX)
    .default(LIMITS.HISTORY_PAGE_SIZE),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ReadReceiptInput = z.infer<typeof readReceiptSchema>;
export type MessageSyncInput = z.infer<typeof messageSyncSchema>;
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;
