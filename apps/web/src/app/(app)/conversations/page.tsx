'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';

export default function ConversationsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col p-6">
      <header className="flex items-center justify-between border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-50">Signed in as</p>
          <p className="font-medium">{user?.displayName}</p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Log out
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <p className="opacity-60">Conversations are coming soon.</p>
      </div>
    </main>
  );
}
