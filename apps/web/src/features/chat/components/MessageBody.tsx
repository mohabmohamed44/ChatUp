'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import {
  TRUNCATE_AT,
  analyzeDirection,
  isUnbreakable,
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

  const { text: preview, isTruncated } = useMemo(
    () => truncate(text, TRUNCATE_AT),
    [text],
  );

  const { dir, hasMixed } = useMemo(
    () => analyzeDirection(text),
    [text],
  );

  const unbreakable = isUnbreakable(text);
  const display = expanded || !isTruncated ? text : preview;

  return (
    <div className="flex flex-col">
      <p
        dir={dir}
        className={cn(
          // Preserve newlines and wrap long words
          'whitespace-pre-wrap break-words',
          // Isolate BiDi so runs do not scramble siblings
          'unicode-bidi-isolate',
          // Break a single huge token (URL) if needed
          unbreakable && 'break-all',
          // Font fallback that covers Latin + Arabic glyphs
          'font-message',
        )}
      >
        {hasMixed ? <bdi>{display}</bdi> : display}
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