'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { formatFullTimestamp, formatMessageTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { getMediaUrl } from '../api';
import type { ChatMessage } from '../hooks/useConversationMessages';
import { StatusIcon } from './StatusIcon';

export function MessageBubble({
  message,
  isOwn,
  onRetry,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onRetry?: (clientId: string, body: string) => void;
}) {
  const attachment = message.attachment;
  const clientId = message.clientId;
  const body = message.body;
  const canRetry =
    isOwn && message.status === 'failed' && clientId !== null && body !== null;

  const [imgSrc, setImgSrc] = useState<string | null>(attachment?.url ?? null);
  const refreshed = useRef(false);

  useEffect(() => {
    setImgSrc(attachment?.url ?? null);
    refreshed.current = false;
  }, [attachment?.url, attachment?.id]);

  const handleImgError = useCallback(async () => {
    if (!attachment?.id || refreshed.current) return;
    refreshed.current = true;
    try {
      const fresh = await getMediaUrl(attachment.id);
      if (fresh.url) setImgSrc(fresh.url);
    } catch {
      // keep broken src; user sees broken image fallback
    }
  }, [attachment?.id]);

  return (
    <div className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[85%] sm:max-w-[75%]">
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm shadow-sm',
            isOwn
              ? 'rounded-br-md bg-indigo-600 text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-900',
          )}
        >
          {attachment?.kind === 'image' && imgSrc ? (
            <img
              src={imgSrc}
              alt={body ?? 'Image attachment'}
              width={attachment.width ?? undefined}
              height={attachment.height ?? undefined}
              loading="lazy"
              onError={handleImgError}
              className="mb-1.5 max-h-72 w-full rounded-lg object-cover"
            />
          ) : null}

          {attachment?.kind === 'audio' && attachment.url ? (
            <audio
              controls
              preload="none"
              src={attachment.url}
              className="mb-1.5 h-9 w-56 max-w-full"
            >
              <track kind="captions" />
            </audio>
          ) : null}

          {body ? <p className="whitespace-pre-wrap break-words">{body}</p> : null}

          <div
            className={cn(
              'mt-1 flex items-center gap-1 text-[11px]',
              isOwn ? 'justify-end text-indigo-100' : 'text-slate-400',
            )}
          >
            <time dateTime={message.createdAt} title={formatFullTimestamp(message.createdAt)}>
              {formatMessageTime(message.createdAt)}
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
