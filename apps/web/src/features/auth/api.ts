import type { AuthUser, LoginInput, RegisterInput } from '@chatup/shared';
import { apiFetch } from '../../shared/lib/api';

export interface AuthResponse {
  user: AuthUser;
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: input });
}

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: input });
}

export function me(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/me');
}

export function logout(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}
