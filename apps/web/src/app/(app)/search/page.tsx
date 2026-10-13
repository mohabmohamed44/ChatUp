'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search as SearchIcon, X } from 'lucide-react';
import { timeFilterValues, type TimeFilter } from '@chatup/shared';
import { useSearch } from '@/features/search/hooks/useSearch';
import { HighlightedSnippet } from '@/features/search/components/HighlightedSnippet';
import { formatListTimestamp } from '@/shared/lib/format';

const FILTER_LABELS: Record<TimeFilter, string> = {
  any: 'Any time',
  '24h': 'Last 24 hours',
  week: 'Last week',
  month: 'Last month',
  '3months': 'Last 3 months',
  year: 'Last year',
  older: 'Older than a year',
  custom: 'Custom range',
};

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('any');
  const router = useRouter();
  const { results, loading, error } = useSearch({ q, timeFilter });

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white p-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages…"
            autoFocus
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 ps-9 pe-9 text-sm focus:border-slate-400 focus:outline-none"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute inset-end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {timeFilterValues.map((f) => (
            <button
              key={f}
              onClick={() => setTimeFilter(f)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                timeFilter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {q.length < 2 && (
          <p className="mt-12 text-center text-sm text-slate-500">
            Type at least 2 characters to search.
          </p>
        )}

        {loading && <p className="mt-12 text-center text-sm text-slate-500">Searching…</p>}

        {error && <p className="mt-12 text-center text-sm text-red-600">{error}</p>}

        {!loading && !error && q.length >= 2 && results.length === 0 && (
          <p className="mt-12 text-center text-sm text-slate-500">No results.</p>
        )}

        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() =>
                  router.push(`/conversations/${r.conversationId}?jumpTo=${r.sequence}`)
                }
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-start transition hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{r.senderName}</span>
                  <span>{formatListTimestamp(r.createdAt, 'en')}</span>
                </div>
                <p className="text-sm text-slate-800">
                  <HighlightedSnippet html={r.snippet} />
                </p>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
