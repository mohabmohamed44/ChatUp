import type { Ack, Page } from './common';
import type { ConversationSummary } from './conversations/types';
import type {
  Message,
  MessageStatusUpdate,
  MessageSyncPayload,
  ReadReceiptPayload,
  SendMessagePayload,
} from './messages/types';
import type { PresenceStatus } from './presence/types';
import type { ISODateString } from './common';

export const SOCKET_ROOMS = {
  user: (userId: string) => `user:${userId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
} as const;

export interface TypingStartPayload {
  conversationId: string;
}

export interface TypingUpdatePayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface PresenceUpdate {
  userId: string;
  status: PresenceStatus;
  at: ISODateString;
}

export interface ClientToServerEvents {
  'message:send': (payload: SendMessagePayload, ack: (result: Ack<Message>) => void) => void;
  'message:new': (payload: { message: Message }, ack: () => void) => void;
  'message:read': (payload: ReadReceiptPayload, ack: (result: Ack<null>) => void) => void;
  'message:sync': (payload: MessageSyncPayload, ack: (result: Ack<Page<Message>>) => void) => void;
  'typing:start': (payload: TypingStartPayload) => void;
  'presence:snapshot': (userIds: string[]) => void;
}

export interface ServerToClientEvents {
  'message:new': (payload: { message: Message }, ack?: () => void) => void;
  'message:status': (payload: MessageStatusUpdate) => void;
  'conversation:created': (payload: { conversation: ConversationSummary }) => void;
  'conversation:updated': (payload: { conversation: ConversationSummary }) => void;
  'presence:update': (payload: PresenceUpdate) => void;
  'typing:update': (payload: TypingUpdatePayload) => void;
}

export interface SocketData {
  userId: string;
}
