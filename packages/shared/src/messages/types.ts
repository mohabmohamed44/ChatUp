import type { ISODateString } from '../common';
import type { Attachment } from '../media/types';

export type MessageKind = 'text' | 'image' | 'audio';

export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read';

export type ClientMessageStatus = MessageDeliveryStatus | 'pending' | 'failed';

export interface Message {
  id: string;
  sequence: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string | null;
  attachment: Attachment | null;
  status: MessageDeliveryStatus;
  clientId: string | null;
  createdAt: ISODateString;
}

export interface MessagePreview {
  messageId: string;
  senderId: string;
  kind: MessageKind;
  preview: string;
  createdAt: ISODateString;
}

export interface SendMessagePayload {
  conversationId: string;
  clientId: string;
  kind: MessageKind;
  body?: string;
  attachmentId?: string;
  durationMs?: number;
}

export interface ReadReceiptPayload {
  conversationId: string;
  upToMessageId?: string;
}

export interface MessageSyncPayload {
  conversationId: string;
  afterSequence?: string | null;
  limit?: number;
}

export interface MessageStatusUpdate {
  conversationId: string;
  messageIds: string[];
  status: 'delivered' | 'read';
  at: ISODateString;
}
