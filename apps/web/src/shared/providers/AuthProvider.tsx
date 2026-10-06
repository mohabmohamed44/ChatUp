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
  type UpdateAvatarInput,
  updateAvatar as updateAvatarRequest,
} from '../../features/auth/api';
import { getSocket } from '../lib/socket';
import { clearCache, getCachedUserId, pruneOldData, setCachedUserId } from '../lib/cache';
import { AwardIcon } from 'lucide-react';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  updateAvatar: (input: UpdateAvatarInput) => Promise<AuthUser>;
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
        if (cancelled) return;
        setUser(response.user);
        // Persist userId so meta is populated on reload, not just login/register.
        if (response.user) void setCachedUserId(response.user.id);
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

  // Prune 7-day-old cached data once on app start. Failures never break the app.
  useEffect(() => {
    void pruneOldData();
  }, []);

  // Clear local cache on logout / unauthenticated state.
  useEffect(() => {
    if (user === null && isLoading === false) {
      void clearCache();
    }
  }, [user, isLoading]);

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

  // Connect the socket when the user logs in, disconnect on logout.
  useEffect(() => {
    const socket = getSocket();
    if (user) {
      if (!socket.connected) socket.connect();
    } else {
      socket.disconnect();
    }
  }, [user]);

  // Handle socket auth errors: if the session is invalid, clear the user
  // so the app redirects to /login.
  useEffect(() => {
    const socket = getSocket();
    function onConnectError(err: Error) {
      if (err.message === 'unauthorized') {
        setUser(null);
      }
    }
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('connect_error', onConnectError);
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const response = await loginRequest(input);

    const previousUserId = await getCachedUserId();
    if (previousUserId && previousUserId !== response.user.id) {
      await clearCache();
    }
    await setCachedUserId(response.user.id);
    setUser(response.user);
    return response.user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const response = await registerRequest(input);
    await clearCache();
    await setCachedUserId(response.user.id);
    setUser(response.user);
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    await clearCache();
    setUser(null);
  }, []);

  const updateAvatar = useCallback(async (input: UpdateAvatarInput) => {
    const response = await updateAvatarRequest(input);
    setUser(response.user);
    return response.user;
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout, updateAvatar }),
    [user, isLoading, login, register, logout, updateAvatar],
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