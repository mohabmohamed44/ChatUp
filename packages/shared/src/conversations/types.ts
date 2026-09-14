import type { ISODateString } from '../common';
import type { PublicUser } from '../auth/types';
import type { MessagePreview } from '../messages/types';

export interface ConversationSummary {
  id: string;
  participants: PublicUser[];
  lastMessage: MessagePreview | null;
  unreadCount: number;
  lastActivityAt: ISODateString;
}
