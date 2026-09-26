'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  TRUNCATE_AT,
  analyzeDirection,
  isUnbreakable,
  segmentText,
  truncate,
} from '@/shared/lib/text';

export function MessageBody({
  text,
  isOwn,
}: {
  text: string;
  isOwn: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const { text: preview, isTruncated } = useMemo(() => truncate(text, TRUNCATE_AT), [text]);
  const { dir, hasMixed } = useMemo(() => analyzeDirection(text), [text]);

  const display = expanded || !isTruncated ? text : preview;
  const segments = useMemo(() => segmentText(display), [display]);
  const unbreakable = isUnbreakable(text);

  return (
    <div className="flex flex-col">
      <p
        dir={dir}
        className={cn(
          'whitespace-pre-wrap break-words',
          'unicode-bidi-isolate',
          unbreakable && 'break-all',
          'font-message',
        )}
      >
        {hasMixed ? (
          <bdi>
            {segments.map((seg, i) =>
              seg.type === 'text' ? (
                <span key={i}>{seg.value}</span>
              ) : (
                <a
                  key={i}
                  href={seg.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={cn(
                    'underline underline-offset-2 break-all',
                    isOwn
                      ? 'text-indigo-100 hover:text-white'
                      : 'text-indigo-600 hover:text-indigo-500',
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  {seg.value}
                </a>
              ),
            )}
          </bdi>
        ) : (
          segments.map((seg, i) =>
            seg.type === 'text' ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <a
                key={i}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(
                  'underline underline-offset-2 break-all',
                  isOwn
                    ? 'text-indigo-100 hover:text-white'
                    : 'text-indigo-600 hover:text-indigo-500',
                )}
                onClick={(e) => e.stopPropagation()}
              >
                {seg.value}
              </a>
            ),
          )
        )}
      </p>

      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'mt-1 self-start text-xs font-medium underline-offset-2 hover:underline',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
            isOwn
              ? 'text-indigo-100 focus-visible:ring-white'
              : 'text-indigo-600 focus-visible:ring-indigo-500',
          )}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}