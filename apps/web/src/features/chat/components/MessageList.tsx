'use client';

import { useLayoutEffect, useRef, type UIEvent } from 'react';
import type { ChatMessage } from '../hooks/useConversationMessages';
import { MessageBubble } from './MessageBubble';

const STICK_THRESHOLD_PX = 120;

export function MessageList({
  messages,
  currentUserId,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  onLoadMore,
  onRetry,
  onRetryLoad,
}: {
  messages: ChatMessage[];
  currentUserId: string;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: (clientId: string, body: string) => void;
  onRetryLoad: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const firstIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    shouldStickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  }

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const firstId = messages[0]?.id ?? null;
    const lastId = messages.at(-1)?.id ?? null;
    const prepended =
      firstId !== firstIdRef.current &&
      lastId === lastIdRef.current &&
      firstIdRef.current !== null;
    const appended = lastId !== lastIdRef.current;

    if (prepended) {
      // Keep the previously visible messages anchored when older ones load.
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    } else if (appended && shouldStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }

    firstIdRef.current = firstId;
    lastIdRef.current = lastId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading messages…</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      role="log"
      aria-label="Messages"
      className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-4"
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-700">
          <span role="alert">{error}</span>
          <button
            type="button"
            onClick={onRetryLoad}
            className="ml-2 rounded font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Retry
          </button>
        </div>
      ) : null}

      {hasMore ? (
        <div className="mb-3 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoadingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        </div>
      ) : null}

      {messages.length === 0 && !error ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-slate-500">No messages yet. Say hello.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {messages.map((message) => (
            <li key={message.id}>
              <MessageBubble
                message={message}
                isOwn={message.senderId === currentUserId}
                onRetry={onRetry}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
