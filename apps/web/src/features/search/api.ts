import type { SearchResult } from '@chatup/shared';
import { apiFetch } from '@/shared/lib/api';

export interface searchMessageParams {
  q: string;
  conversationId?: string;
  partnerId?: string;
  after?: Date;
  before?: Date;
  cursor?: string;
  limit?: number;
}

export async function searchMessagesApi(
  input: searchMessageParams,
): Promise<{ results: SearchResult[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set('q', input.q);

  if (input.conversationId) params.set('conversationId', input.conversationId);
  if (input.partnerId) params.set('partnerId', input.partnerId);
  if (input.after) params.set('after', input.after.toISOString());
  if (input.before) params.set('before', input.before.toISOString());
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.limit) params.set('limit', String(input.limit));

  return apiFetch(`/search/messages?${params.toString()}`);
}
