'use client';

import { useEffect, useState } from 'react';
import type { SearchResult, TimeFilter } from '@chatup/shared';
import { searchMessagesApi } from '../api';
import { useDebouncedValue } from './useDebouncedValue';

export function timeFilterToRange(
  filter: TimeFilter,
  custom?: { from?: Date; to?: Date },
): { after?: Date; before?: Date } {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  switch (filter) {
    case '24h':
      return { after: new Date(now.getTime() - day) };
    case 'week':
      return { after: new Date(now.getTime() - 7 * day) };
    case 'month':
      return { after: new Date(now.getTime() - 30 * day) };
    case '3months':
      return { after: new Date(now.getTime() - 90 * day) };
    case 'year':
      return { after: new Date(now.getTime() - 365 * day) };
    case 'older':
      return { before: new Date(now.getTime() - 365 * day) };
    case 'custom':
      return { after: custom?.from, before: custom?.to };
    default:
      return {};
  }
}

export function useSearch(params: {
  q: string;
  timeFilter: TimeFilter;
  custom?: { from?: Date; to?: Date };
  partnerId?: string;
}) {
  const debouncedQ = useDebouncedValue(params.q, 300);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (debouncedQ.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const { after, before } = timeFilterToRange(
      params.timeFilter,
      params.custom,
    );

    searchMessagesApi({
      q: debouncedQ,
      after,
      before,
      partnerId: params.partnerId,
    })
      .then((data) => {
        if (!cancelled) setResults(data.results);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Search failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedQ,
    params.timeFilter,
    params.partnerId,
    params.custom?.from?.toISOString(),
    params.custom?.to?.toISOString(),
  ]);

  return { results, loading, error };
}