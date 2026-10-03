'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { stopAllVoicePlayback } from '@/features/chat/lib/voicePlayback';

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
    editMessage,
    deleteMessage,
    markPlayed,
  } = useConversationMessages(conversationId, currentUserId);

  const [editingMessage, setEditingMessage] = useState<{ id: string; body: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  // WhatsApp-like: leaving / switching the chat stops any playing voice note.
  useEffect(() => {
    return () => {
      stopAllVoicePlayback();
    };
  }, [conversationId]);

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
        onRetry={(clientId, body) => sendMessage({ kind: 'text', body }, clientId)}
        onRetryLoad={reload}
        onEdit={(messageId, currentBody) => setEditingMessage({ id: messageId, body: currentBody })}
        onDelete={(messageId) => setPendingDelete(messageId)}
        onMarkPlayed={(messageId) => void markPlayed(messageId)}
      />

      <MessageComposer
        conversationId={conversationId}
        onSend={(body) => sendMessage(body)}
        onTyping={notifyTyping}
        disabled={!isConnected}
        editMode={
          editingMessage
            ? {
                body: editingMessage.body,
                onSave: async (newBody) => {
                  await editMessage(editingMessage.id, newBody);
                  setEditingMessage(null);
                },
                onCancel: () => setEditingMessage(null),
              }
            : null
        }
      />

      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
            <p className="mb-3 text-sm">Delete this message?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await deleteMessage(pendingDelete);
                  setPendingDelete(null);
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
