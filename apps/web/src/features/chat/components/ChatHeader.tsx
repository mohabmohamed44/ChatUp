'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ConversationSummary, PresenceStatus } from '@chatup/shared';
import { initialsOf } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { LanguageToggle } from '@/shared/components/LanguageToggle';

export function ChatHeader({
  conversation,
  presence,
  isTyping,
}: {
  conversation: ConversationSummary;
  presence: PresenceStatus;
  isTyping: boolean;
}) {
  const other = conversation.participants[0];
  const name = other?.displayName ?? 'Unknown';
  const statusText = isTyping ? 'typing…' : presence === 'online' ? 'Online' : 'Offline';

  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-4">
      <Link
        href="/conversations"
        aria-label="Back to conversations"
        className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:hidden"
      >
        <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
      </Link>

      <span className="relative shrink-0">
      {other?.avatarUrl ? (
          <img
            src={other.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
            {initialsOf(name)}
          </span>
        )}
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 h-3 w-3 rounded-full border-2 border-white ltr:-right-0.5 rtl:-left-0.5',
            presence === 'online' ? 'bg-emerald-500' : 'bg-slate-300',
          )}
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
        <p
          aria-live="polite"
          className={cn('truncate text-xs', isTyping ? 'text-indigo-600' : 'text-slate-500')}
        >
          {statusText}
        </p>
      </div>

      <LanguageToggle className="shrink-0" />
    </header>
  );
}
