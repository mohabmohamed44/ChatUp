'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, LoginInput, RegisterInput } from '@chatup/shared';
import {
  login as loginRequest,
  logout as logoutRequest,
  me as fetchMe,
  register as registerRequest,
} from '../../features/auth/api';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initial session check: fetch current user on mount.
  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((response) => {
        if (!cancelled) setUser(response.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Global 401 handler: any API call that returns 401 dispatches
  // "chatup:unauthorized". Clear the user so the app redirects to /login.
  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
    }
    window.addEventListener('chatup:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('chatup:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const response = await loginRequest(input);
    setUser(response.user);
    return response.user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const response = await registerRequest(input);
    setUser(response.user);
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}