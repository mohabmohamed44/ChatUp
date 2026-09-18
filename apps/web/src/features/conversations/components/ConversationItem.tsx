'use client';

import Link from 'next/link';
import type { ConversationSummary, PresenceStatus } from '@chatup/shared';
import { formatListTimestamp, initialsOf } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';

export function ConversationItem({
  conversation,
  currentUserId,
  isActive,
  presence,
}: {
  conversation: ConversationSummary;
  currentUserId: string;
  isActive: boolean;
  presence: PresenceStatus;
}) {
  const other = conversation.participants[0];
  const name = other?.displayName ?? 'Unknown';
  const lastMessage = conversation.lastMessage;
  const unread = conversation.unreadCount > 0;
  const preview = lastMessage
    ? `${lastMessage.senderId === currentUserId ? 'You: ' : ''}${lastMessage.preview}`
    : 'No messages yet';

  return (
    <li>
      <Link
        href={`/conversations/${conversation.id}`}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
          isActive ? 'bg-indigo-50' : 'hover:bg-slate-100',
        )}
      >
        <span className="relative shrink-0">
          <span
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold',
              isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-700',
            )}
          >
            {initialsOf(name)}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white',
              presence === 'online' ? 'bg-emerald-500' : 'bg-slate-300',
            )}
          />
          <span className="sr-only">{presence === 'online' ? 'Online' : 'Offline'}</span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'truncate text-sm text-slate-900',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </span>
            {lastMessage ? (
              <time
                dateTime={lastMessage.createdAt}
                className="shrink-0 text-xs text-slate-400"
              >
                {formatListTimestamp(lastMessage.createdAt)}
              </time>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate text-xs',
                unread ? 'font-medium text-slate-700' : 'text-slate-500',
              )}
            >
              {preview}
            </span>
            {unread ? (
              <span
                aria-label={`${conversation.unreadCount} unread messages`}
                className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-white"
              >
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
