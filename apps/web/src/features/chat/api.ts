import { LIMITS } from '@chatup/shared';
import { apiFetch } from '@/shared/lib/api';
import type { Attachment, Message, Page } from '@chatup/shared';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.slice(name.length + 1));
}

export function fetchMessageHistory(
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<Page<Message>> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  params.set('limit', String(opts.limit ?? 30));
  return apiFetch(`/conversations/${conversationId}/messages?${params}`);
}

export async function uploadMedia(file: File, kind: 'image' | 'audio', durationMs?: number) {
  const form = new FormData();
  form.append('file', file);

  if (durationMs !== undefined) form.append('durationMs', String(durationMs));

  const headers = new Headers();
  const csrfToken = readCookie(LIMITS.CSRF_COOKIE_NAME);
  if (csrfToken) headers.set(LIMITS.CSRF_HEADER_NAME, csrfToken);

  const res = await fetch(`/api/media/${kind}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: form, // no Content-Type header — the browser sets multipart boundary
  });

  if (!res.ok) throw new Error('Upload failed');
  return res.json() as Promise<{ attachment: Attachment }>;
}

export async function getMediaUrl(attachmentId: string): Promise<{url: string}> {
  return apiFetch<{url: string}>(`/media/${attachmentId}`);
}