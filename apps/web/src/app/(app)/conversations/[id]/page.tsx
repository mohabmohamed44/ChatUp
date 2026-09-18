'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/features/auth';
import { ChatHeader } from '@/features/chat/components/ChatHeader';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { MessageList } from '@/features/chat/components/MessageList';
import { useConversationMessages } from '@/features/chat/hooks/useConversationMessages';
import { usePresence } from '@/features/chat/hooks/usePresence';
import { useSendMessage } from '@/features/chat/hooks/useSendMessage';
import { useSocketStatus } from '@/features/chat/hooks/useSocketStatus';
import { useTyping } from '@/features/chat/hooks/useTyping';
import { useConversations } from '@/features/conversations/hooks/useConversations';

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;
  const { user } = useAuth();
  const { conversations, isLoading: isLoadingConversations } = useConversations();

  const currentUserId = user?.id ?? '';
  const conversation = conversations.find((item) => item.id === conversationId);
  const participant = conversation?.participants[0];

  const {
    messages,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    reload,
    appendOptimistic,
    replaceOptimistic,
    markFailed,
  } = useConversationMessages(conversationId, currentUserId);

  const sendMessage = useSendMessage(
    conversationId,
    currentUserId,
    appendOptimistic,
    replaceOptimistic,
    markFailed,
  );
  const { isConnected } = useSocketStatus();
  const { typingUserIds, notifyTyping } = useTyping(conversationId, currentUserId);
  const presence = usePresence(participant ? [participant.id] : []);

  if (!user) return null;

  if (!conversation) {
    if (isLoadingConversations) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-50">
          <p className="text-sm text-slate-500">Loading conversation…</p>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-800">Conversation not found</h1>
        <p className="max-w-xs text-sm text-slate-500">
          It may have been removed, or you may not be a participant.
        </p>
        <Link
          href="/conversations"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Back to conversations
        </Link>
      </div>
    );
  }

  const isTyping = participant ? typingUserIds.includes(participant.id) : false;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      <ChatHeader
        conversation={conversation}
        presence={participant ? presence[participant.id] ?? 'offline' : 'offline'}
        isTyping={isTyping}
      />

      {!isConnected ? (
        <p
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800"
        >
          Reconnecting… messages will send once the connection returns.
        </p>
      ) : null}

      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        hasMore={hasMore}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        error={error}
        onLoadMore={() => void loadMore()}
        onRetry={(clientId, body) => sendMessage(body, clientId)}
        onRetryLoad={reload}
      />

      <MessageComposer
        onSend={(body) => sendMessage(body)}
        onTyping={notifyTyping}
        disabled={!isConnected}
      />
    </div>
  );
}
