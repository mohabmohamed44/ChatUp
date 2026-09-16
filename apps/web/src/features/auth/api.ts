import type { AuthUser, LoginInput, RegisterInput } from '@chatup/shared';
import { ApiError, apiFetch } from '../../shared/lib/api';

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
