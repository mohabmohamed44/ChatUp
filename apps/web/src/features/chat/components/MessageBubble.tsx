'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, EllipsisVertical, Info, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { formatBubbleTimestamp, formatFullTimestamp } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { useLocale } from '@/shared/providers/LocaleProvider';
import { ImageMessage } from './ImageMessage';
import { MessageBody } from './MessageBody';
import { MessageInfoModal } from './MessageInfoModal';
import { VoiceMessage } from './VoiceMessage';
import type { ChatMessage } from '../hooks/useConversationMessages';
import { StatusIcon } from './StatusIcon';
import { useToast } from '@/shared/providers/ToastProvider';

export function MessageBubble({
  message,
  isOwn,
  onRetry,
  onEdit,
  onDelete,
  onMarkPlayed,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onRetry?: (clientId: string, body: string) => void;
  onEdit?: (messageId: string, currentBody: string) => void;
  onDelete?: (messageId: string) => void;
  onMarkPlayed?: (messageId: string) => void;
}) {
  const { locale } = useLocale();
  const attachment = message.attachment;
  const clientId = message.clientId;
  const body = message.body;

  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const canRetry =
    isOwn &&
    message.status === 'failed' &&
    message.kind === 'text' &&
    clientId !== null &&
    body !== null;

  const canCopy = message.kind === 'text' && body !== null && body.length > 0;
  const isMediaOnly = message.kind !== 'text';

  const EDIT_WINDOW_MS = 15 * 60 * 1000;

  const isDeleted = Boolean(message.deletedAt);
  const canEdit =
    !isDeleted &&
    isOwn &&
    message.kind === 'text' &&
    message.status !== 'failed' &&
    Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
  const canDelete = !isDeleted && isOwn;
  const canShowInfo =
    isOwn &&
    message.kind === 'audio' &&
    !isDeleted &&
    message.status !== 'pending' &&
    message.status !== 'failed';
  const hasMenu = canEdit || canDelete || canShowInfo;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Close the menu on outside click or Escape, returning focus to the trigger.
  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  async function handleCopy() {
    if (!body) return;

    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.showToast('Copied to clipboard', { variant: 'success', duration: 2000 });
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.showToast('Failed to copy', { variant: 'error', duration: 2500 });
      console.warn('[copy] failed', err);
    }
  }

  return (
    <div className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[85%] sm:max-w-[75%]">
        <div
          className={cn(
            'group rounded-2xl text-sm shadow-sm',
            isMediaOnly ? 'px-1.5 py-1.5' : 'px-3.5 py-2',
            isOwn
              ? 'rounded-br-md bg-indigo-600 text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-900',
          )}
        >
          {isDeleted ? (
            <p className="italic text-slate-400">
              <Trash2 className="inline h-3 w-3 mr-1" aria-hidden="true" />
              This message was deleted
            </p>
          ) : (
            <>
              {message.kind === 'image' && attachment ? (
                <ImageMessage attachment={attachment} />
              ) : null}

              {message.kind === 'audio' && attachment ? (
                <VoiceMessage
                  attachment={attachment}
                  isOwn={isOwn}
                  playedAt={message.playedAt}
                  playedTitle={
                    message.playedAt
                      ? `Played · ${formatFullTimestamp(message.playedAt, locale)}`
                      : undefined
                  }
                  onPlayed={() => onMarkPlayed?.(message.id)}
                />
              ) : null}

              {message.kind === 'text' && body ? (
                <MessageBody text={body} isOwn={isOwn} />
              ) : null}
            </>
          )}

          <div
            className={cn(
              'flex items-center gap-1 text-[11px]',
              isMediaOnly ? 'mt-0.5 px-2' : 'mt-1',
              isOwn ? 'justify-end text-indigo-100' : 'text-slate-400',
            )}
          >
            {canCopy ? (
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy message"
                className={cn(
                  'rounded p-0.5 transition-opacity',
                  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                  copied && 'opacity-100',
                  isOwn
                    ? 'text-indigo-100 hover:bg-white/10 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                )}
              >
                {copied ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden="true" />
                )}
              </button>
            ) : null}

            {hasMenu ? (
              <div ref={menuRef} className="relative">
                <button
                  ref={menuButtonRef}
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Message options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={cn(
                    'rounded p-0.5 transition-opacity',
                    'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                    menuOpen && 'opacity-100',
                    isOwn
                      ? 'text-indigo-100 hover:bg-white/10 hover:text-white'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  )}
                >
                  <EllipsisVertical className="h-3 w-3" aria-hidden="true" />
                </button>

                {menuOpen ? (
                  <div
                    role="menu"
                    aria-label="Message actions"
                    className="absolute end-0 top-full z-20 mt-1 min-w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    {canShowInfo ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setInfoOpen(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-slate-700 transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none"
                      >
                        <Info className="h-3 w-3" aria-hidden="true" />
                        Info
                      </button>
                    ) : null}

                    {canEdit ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onEdit?.(message.id, body ?? '');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-slate-700 transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Edit
                      </button>
                    ) : null}

                    {canDelete ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete?.(message.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-red-600 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <time
              dateTime={message.createdAt}
              title={formatFullTimestamp(message.createdAt, locale)}
            >
              {formatBubbleTimestamp(message.createdAt, locale)}
            </time>
            {message.editedAt && !isDeleted ? (
              <span className={cn('text-[10px] italic', isOwn ? 'text-indigo-200' : 'text-slate-400')}>
                (edited)
              </span>
            ) : null}
            {isOwn ? (
              canShowInfo ? (
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  aria-label="Message info"
                  title="Message info"
                  className="inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <StatusIcon status={message.status} />
                </button>
              ) : (
                <StatusIcon status={message.status} />
              )
            ) : null}
          </div>
        </div>

        {canRetry ? (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => onRetry?.(clientId, body)}
              className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-red-600 transition-colors hover:text-red-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : null}
      </div>

      {infoOpen ? (
        <MessageInfoModal message={message} onClose={() => setInfoOpen(false)} />
      ) : null}
    </div>
  );
}