'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Plus, X } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { usePresence } from '@/features/chat/hooks/usePresence';
import { initialsOf } from '@/shared/lib/format';
import { useConversations } from '../hooks/useConversations';
import { ConversationItem } from './ConversationItem';
import { NewChatSearch } from './NewChatSearch';

export function ConversationList() {
  const { user, logout } = useAuth();
  const { conversations, isLoading, error, refetch } = useConversations();
  const pathname = usePathname();
  const router = useRouter();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);

  const participantIds = useMemo(
    () => conversations.flatMap((conversation) => conversation.participants.map((p) => p.id)),
    [conversations],
  );
  const presence = usePresence(participantIds);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M4.5 6.75A3.75 3.75 0 0 1 8.25 3h7.5A3.75 3.75 0 0 1 19.5 6.75v7.5a3.75 3.75 0 0 1-3.75 3.75H13.5l-3.9 3.3a.75.75 0 0 1-1.2-.6V18h-.15A3.75 3.75 0 0 1 4.5 14.25v-7.5Z" />
            </svg>
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-900">ChatUp</span>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Log out"
          title="Log out"
          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {isNewChatOpen ? (
        <div id="new-chat-panel" className="border-b border-slate-200 bg-slate-50/60">
          <NewChatSearch onDone={() => setIsNewChatOpen(false)} />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Conversations
        </h2>
        <button
          type="button"
          onClick={() => setIsNewChatOpen((open) => !open)}
          aria-expanded={isNewChatOpen}
          aria-controls="new-chat-panel"
          aria-label={isNewChatOpen ? 'Close new chat' : 'New chat'}
          title={isNewChatOpen ? 'Close new chat' : 'New chat'}
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {isNewChatOpen ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <ul className="space-y-2 px-1" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-200" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/3 animate-pulse rounded bg-slate-200" />
                  <span className="block h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                </span>
              </li>
            ))}
          </ul>
        ) : error ? (
          <div className="px-4 py-6 text-center">
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">No conversations yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Use “New chat” to find someone and start messaging.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const other = conversation.participants[0];
              return (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  currentUserId={user?.id ?? ''}
                  isActive={pathname === `/conversations/${conversation.id}`}
                  presence={other ? presence[other.id] ?? 'offline' : 'offline'}
                />
              );
            })}
          </ul>
        )}
      </div>

      {user ? (
        <footer className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
            {initialsOf(user.displayName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">
              {user.displayName}
            </span>
            <span className="block truncate text-xs text-slate-400">{user.email}</span>
          </span>
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            You
          </span>
        </footer>
      ) : null}
    </div>
  );
}