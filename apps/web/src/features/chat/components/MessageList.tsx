'use client';

import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage } from '../hooks/useConversationMessages';
import { MessageBubble } from './MessageBubble';
import { cn } from '@/shared/lib/utils';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  onRetry: (clientId: string, body: string) => void;
  onRetryLoad: () => void;
  onEdit?: (messageId: string, currentBody: string) => void;
  onDelete?: (messageId: string) => void;
  onMarkPlayed?: (messageId: string) => void;
  /**
   * Number of unread messages at the moment the conversation was opened.
   * Captured once and passed here as a stable number. Pass `0` when there
   * are no unread messages.
   */
  initialUnreadCount?: number;
}

const STICK_THRESHOLD_PX = 120;
const SCROLL_SHOW_BUTTON_PX = 300;

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
  onEdit,
  onDelete,
  onMarkPlayed,
  initialUnreadCount = 0,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const firstIdRef = useRef<string | null>(null);
  const lastIdRef = useRef<string | null>(null);

  const [showJumpButton, setShowJumpButton] = useState(false);

  // -------------------------------------------------------------------------
  // Unread divider index
  // -------------------------------------------------------------------------
  // The divider appears before the first unread message. Since unread
  // messages are the newest ones, its index is (length - unreadCount).
  const unreadDividerIndex = useMemo(() => {
    if (initialUnreadCount <= 0) return -1;
    if (initialUnreadCount > messages.length) return 0; // clamped
    return messages.length - initialUnreadCount;
  }, [initialUnreadCount, messages.length]);

  function updateJumpVisibility(el: HTMLDivElement) {
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpButton(distanceFromBottom > SCROLL_SHOW_BUTTON_PX);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    shouldStickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    updateJumpVisibility(el);
    // Hybrid loading: scrolling near the top auto-fetches older history.
    // The button stays as fallback (short lists, retry after failure).
    // Duplicate fetches are blocked by the loading guard in the hook.
    if (el.scrollTop < 100 && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }

  // Latest stable onLoadMore for effects (page.tsx passes an inline arrow,
  // so reading the prop directly would re-run effects every render).
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

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
      if (shouldStickRef.current) {
        // User asked for the bottom (e.g. tapped "Latest" while older
        // history was loading) — honor it instead of anchoring mid-list.
        el.scrollTop = el.scrollHeight;
      } else {
        // Keep the previously visible messages anchored when older ones load.
        el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      }
    } else if (appended && shouldStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }

    firstIdRef.current = firstId;
    lastIdRef.current = lastId;
    prevScrollHeightRef.current = el.scrollHeight;
    updateJumpVisibility(el);
  }, [messages]);

  // If the loaded history is shorter than the viewport there is no scroll
  // range, so no scroll event will ever fire to trigger loading.
  // Keep paging until the viewport is filled or history runs out.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isLoading || isLoadingMore || !hasMore) return;
    if (el.scrollHeight <= el.clientHeight + 100) {
      onLoadMoreRef.current();
    }
  }, [messages, isLoading, isLoadingMore, hasMore]);

  const jumpToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    shouldStickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading messages…</p>
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 p-6">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
        <button
          type="button"
          onClick={onRetryLoad}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">No messages yet. Say hello.</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-50">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Messages"
        className="h-full overflow-y-auto px-3 py-4 sm:px-4"
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

        <ul className="space-y-1.5">
          {messages.map((message, index) => {
            const showDivider = index === unreadDividerIndex;

            return (
              <Fragment key={message.clientId ?? message.id}>
                {showDivider ? (
                  <li aria-hidden="false">
                    <UnreadDivider />
                  </li>
                ) : null}
                <li>
                  <MessageBubble
                    message={message}
                    isOwn={message.senderId === currentUserId}
                    onRetry={onRetry}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onMarkPlayed={onMarkPlayed}
                  />
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {showJumpButton ? (
        <button
          type="button"
          onClick={jumpToLatest}
          aria-label="Jump to latest message"
          className={cn(
            'absolute bottom-4 end-4 z-10 flex items-center justify-center gap-1.5 rounded-full',
            'bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-lg',
            'transition-all hover:bg-indigo-500 hover:shadow-xl',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
          )}
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          Latest
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unread divider sub-component
// ---------------------------------------------------------------------------

function UnreadDivider() {
  return (
    <div
      role="separator"
      aria-label="Unread messages"
      className="flex items-center gap-2 py-2"
    >
      <div className="h-px flex-1 bg-indigo-200" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
        Unread messages
      </span>
      <div className="h-px flex-1 bg-indigo-200" />
    </div>
  );
}
