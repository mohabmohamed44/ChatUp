import { describe, expect, it } from 'vitest';
import { LIMITS } from '../constants';
import {
  deleteMessageSchema,
  editMessageSchema,
  markPlayedSchema,
  messageHistoryQuerySchema,
  readReceiptSchema,
  sendMessageSchema,
} from './schemas';

const CONVERSATION_ID = '123e4567-e89b-12d3-a456-426614174000';
const CLIENT_ID = '123e4567-e89b-12d3-a456-426614174001';
const ATTACHMENT_ID = '123e4567-e89b-12d3-a456-426614174002';
const MESSAGE_ID = '123e4567-e89b-12d3-a456-426614174003';

describe('sendMessageSchema', () => {
  it('accepts a text message with a body', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: CONVERSATION_ID,
      clientId: CLIENT_ID,
      kind: 'text',
      body: 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a text message without a body', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'text',
      }).success,
    ).toBe(false);
  });

  it('rejects a whitespace-only body', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'text',
        body: '   ',
      }).success,
    ).toBe(false);
  });

  it('rejects an over-long body', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'text',
        body: 'x'.repeat(LIMITS.MESSAGE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('accepts an image message with an attachment and no body', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: CONVERSATION_ID,
      clientId: CLIENT_ID,
      kind: 'image',
      attachmentId: ATTACHMENT_ID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an image message that also carries a text body', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'image',
        attachmentId: ATTACHMENT_ID,
        body: 'caption?',
      }).success,
    ).toBe(false);
  });

  it('rejects an image message without an attachment', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'image',
      }).success,
    ).toBe(false);
  });

  it('requires durationMs for audio messages', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'audio',
        attachmentId: ATTACHMENT_ID,
      }).success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'audio',
        attachmentId: ATTACHMENT_ID,
        durationMs: 5000,
      }).success,
    ).toBe(true);
  });

  it('rejects audio durationMs beyond the recording cap', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: CONVERSATION_ID,
        clientId: CLIENT_ID,
        kind: 'audio',
        attachmentId: ATTACHMENT_ID,
        durationMs: LIMITS.RECORDING_MAX_SECONDS * 1000 + 1,
      }).success,
    ).toBe(false);
  });

  it('rejects non-UUID identifiers', () => {
    expect(
      sendMessageSchema.safeParse({
        conversationId: 'not-a-uuid',
        clientId: CLIENT_ID,
        kind: 'text',
        body: 'hi',
      }).success,
    ).toBe(false);
  });
});

describe('messageHistoryQuerySchema', () => {
  it('defaults the limit to HISTORY_PAGE_SIZE', () => {
    const result = messageHistoryQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(LIMITS.HISTORY_PAGE_SIZE);
  });

  it('coerces a string limit', () => {
    const result = messageHistoryQuerySchema.safeParse({ limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(10);
  });

  it('rejects out-of-range limits', () => {
    expect(messageHistoryQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      messageHistoryQuerySchema.safeParse({ limit: LIMITS.HISTORY_PAGE_MAX + 1 }).success,
    ).toBe(false);
  });

  it('rejects a non-numeric before cursor', () => {
    expect(messageHistoryQuerySchema.safeParse({ before: 'abc' }).success).toBe(false);
    expect(messageHistoryQuerySchema.safeParse({ before: '123' }).success).toBe(true);
  });
});

describe('edit / delete / receipts', () => {
  it('accepts a valid edit', () => {
    expect(editMessageSchema.safeParse({ messageId: MESSAGE_ID, body: 'edited' }).success).toBe(
      true,
    );
  });

  it('rejects an empty edit body', () => {
    expect(editMessageSchema.safeParse({ messageId: MESSAGE_ID, body: '  ' }).success).toBe(false);
  });

  it('accepts a valid delete', () => {
    expect(deleteMessageSchema.safeParse({ messageId: MESSAGE_ID }).success).toBe(true);
  });

  it('accepts a read receipt without upToMessageId', () => {
    expect(readReceiptSchema.safeParse({ conversationId: CONVERSATION_ID }).success).toBe(true);
  });

  it('accepts a mark-played payload', () => {
    expect(
      markPlayedSchema.safeParse({ messageId: MESSAGE_ID, conversationId: CONVERSATION_ID })
        .success,
    ).toBe(true);
  });
});
