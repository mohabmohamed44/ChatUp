import { apiFetch } from '@/shared/lib/api';
import type { Message, Page } from '@chatup/shared';

export function fetchMessageHistory(
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<Page<Message>> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  params.set('limit', String(opts.limit ?? 30));
  return apiFetch(`/conversations/${conversationId}/messages?${params}`);
}