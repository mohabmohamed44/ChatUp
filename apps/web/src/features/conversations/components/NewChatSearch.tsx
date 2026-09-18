'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LIMITS, type PublicUser } from '@chatup/shared';
import { searchUsers } from '@/features/users/api';
import { initialsOf } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { startDirectConversation } from '../api';

export function NewChatSearch({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= LIMITS.SEARCH_QUERY_MIN;

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then(({ users }) => {
          if (cancelled) return;
          setResults(users);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Search failed');
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, hasQuery]);

  async function start(userId: string) {
    setStartingId(userId);
    setError(null);
    try {
      const { conversation } = await startDirectConversation(userId);
      onDone();
      router.push(`/conversations/${conversation.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not start the conversation');
      setStartingId(null);
    }
  }

  return (
    <div className="space-y-2 p-3">
      <label htmlFor="new-chat-search" className="sr-only">
        Search people by name
      </label>
      <input
        id="new-chat-search"
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search people by name…"
        aria-describedby={resultsId}
        maxLength={100}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/15"
      />

      <div id={resultsId} aria-live="polite" className="text-xs text-slate-500">
        {isSearching ? 'Searching…' : null}
        {!isSearching && hasQuery && results.length === 0 && !error
          ? 'No users found.'
          : null}
        {!hasQuery ? `Type at least ${LIMITS.SEARCH_QUERY_MIN} characters.` : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}

      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {results.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => void start(person.id)}
              disabled={startingId !== null}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                'hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                {initialsOf(person.displayName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {person.displayName}
              </span>
              <span className="text-xs text-indigo-600">
                {startingId === person.id ? 'Starting…' : 'Chat'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
