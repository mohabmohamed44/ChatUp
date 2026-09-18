import { apiFetch } from '@/shared/lib/api';
import type { PublicUser } from '@chatup/shared';

export function searchUsers(query: string): Promise<{ users: PublicUser[] }> {
  return apiFetch(`/users/search?q=${encodeURIComponent(query)}`);
}
