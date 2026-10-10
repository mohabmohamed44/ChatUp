import type { AuthUser, LoginInput, RegisterInput } from '@chatup/shared';
import { ApiError, apiFetch } from '../../shared/lib/api';

export type UpdateAvatarInput = {
  avatarMediaId: string | null;
}

export interface AuthResponse {
  user: AuthUser;
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: input });
}

export async function me(): Promise<{ user: AuthUser | null }> {
  try {
    const response = await apiFetch<{ user: AuthUser }>('/auth/me');
    return response;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { user: null };
    }
    throw error;
  }
}

export function logout(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

/** Best-effort: stop push delivery to this device. Safe to call logged-out. */
export function unregisterFcmToken(): Promise<unknown> {
  return apiFetch<unknown>('/auth/fcm-token', { method: 'DELETE' });
}

export function updateAvatar(input: UpdateAvatarInput): Promise<{ user: AuthUser }> {
  return apiFetch<{ user: AuthUser }>('/auth/profile', { method: 'PATCH', body: input });
}