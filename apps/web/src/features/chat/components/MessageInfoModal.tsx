'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Check, CheckCheck, Mic, X } from 'lucide-react';
import { formatFullTimestamp } from '@/shared/lib/format';
import { useLocale } from '@/shared/providers/LocaleProvider';
import type { ChatMessage } from '../hooks/useConversationMessages';

function InfoRow({
  icon,
  label,
  value,
  done,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  done: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          done ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-400'
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className={`text-xs ${done ? 'text-slate-500' : 'text-slate-400'}`}>
          {value ?? 'Pending'}
        </p>
      </div>
    </div>
  );
}

export function MessageInfoModal({
  message,
  onClose,
}: {
  message: ChatMessage;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const isAudio = message.kind === 'audio' && !message.deletedAt;

  useEffect(() => {
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-info-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="message-info-title" className="text-base font-semibold text-slate-800">
            Message info
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close message info"
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          <InfoRow
            icon={<Check className="h-4 w-4" />}
            label="Sent"
            value={formatFullTimestamp(message.createdAt, locale)}
            done
          />
          <InfoRow
            icon={<CheckCheck className="h-4 w-4" />}
            label="Delivered"
            value={
              message.deliveredAt
                ? formatFullTimestamp(message.deliveredAt, locale)
                : null
            }
            done={Boolean(message.deliveredAt)}
          />
          <InfoRow
            icon={<CheckCheck className="h-4 w-4" />}
            label="Read"
            value={message.readAt ? formatFullTimestamp(message.readAt, locale) : null}
            done={Boolean(message.readAt)}
          />
          {isAudio ? (
            <InfoRow
              icon={<Mic className="h-4 w-4" />}
              label="Played"
              value={
                message.playedAt ? formatFullTimestamp(message.playedAt, locale) : null
              }
              done={Boolean(message.playedAt)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
