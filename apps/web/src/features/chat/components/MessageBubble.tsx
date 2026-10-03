'use client';

import { useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { formatBubbleTimestamp, formatFullTimestamp } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { useLocale } from '@/shared/providers/LocaleProvider';
import { ImageMessage } from './ImageMessage';
import { MessageBody } from './MessageBody';
import { VoiceMessage } from './VoiceMessage';
import type { ChatMessage } from '../hooks/useConversationMessages';
import { StatusIcon } from './StatusIcon';
import { useToast } from '@/shared/providers/ToastProvider';

export function MessageBubble({
  message,
  isOwn,
  onRetry,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onRetry?: (clientId: string, body: string) => void;
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
          {message.kind === 'image' && attachment ? (
            <ImageMessage attachment={attachment} />
          ) : null}

          {message.kind === 'audio' && attachment ? (
            <VoiceMessage attachment={attachment} isOwn={isOwn} />
          ) : null}

          {message.kind === 'text' && body ? (
            <MessageBody text={body} isOwn={isOwn} />
          ) : null}

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

            <time
              dateTime={message.createdAt}
              title={formatFullTimestamp(message.createdAt, locale)}
            >
              {formatBubbleTimestamp(message.createdAt, locale)}
            </time>
            {isOwn ? <StatusIcon status={message.status} /> : null}
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
    </div>
  );
}