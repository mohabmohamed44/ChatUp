'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';

/**
 * Bounces authenticated users away from the auth screens (/login, /register)
 * to the app. Uses the validated user from AuthProvider (server-checked via
 * /auth/me) — never cookie presence, which cannot distinguish a live session
 * from a stale one and would loop logged-out users back to /conversations.
 */
export function RedirectIfAuthenticated() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/conversations');
    }
  }, [isLoading, user, router]);

  return null;
}
