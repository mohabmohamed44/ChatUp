'use client';

import { RotateCcw } from 'lucide-react';
import { formatFullTimestamp, formatMessageTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { ImageMessage } from './ImageMessage';
import { VoiceMessage } from './VoiceMessage';
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

  // Retry is only wired for text messages right now.
  // Image/audio retry would need the attachmentId + kind, which the parent
  // does not currently pass. Keep this limitation until that is added.
  const canRetry =
    isOwn &&
    message.status === 'failed' &&
    message.kind === 'text' &&
    clientId !== null &&
    body !== null;

  // Reduce padding when the bubble contains only media.
  const isMediaOnly = message.kind !== 'text';

  return (
    <div className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[85%] sm:max-w-[75%]">
        <div
          className={cn(
            'rounded-2xl text-sm shadow-sm',
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
            <VoiceMessage isOwn={isOwn} attachment={attachment} />
          ) : null}

          {message.kind === 'text' && body ? (
            <p className="whitespace-pre-wrap break-words">{body}</p>
          ) : null}

          <div
            className={cn(
              'flex items-center gap-1 text-[11px]',
              isMediaOnly ? 'mt-0.5 px-2' : 'mt-1',
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