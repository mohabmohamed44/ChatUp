'use client';

import { usePathname } from 'next/navigation';
import { ConversationList } from '@/features/conversations/components/ConversationList';
import { ConversationsProvider } from '@/features/conversations/hooks/useConversations';
import { cn } from '@/shared/lib/utils';

export default function ConversationsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChatOpen = pathname !== '/conversations';

  return (
    <ConversationsProvider>
      <div className="flex h-dvh overflow-hidden bg-slate-100">
        <aside
          className={cn(
            'w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-80 xl:w-96',
            isChatOpen ? 'hidden lg:flex' : 'flex',
          )}
        >
          <ConversationList />
        </aside>
        <section className={cn('min-w-0 flex-1', isChatOpen ? 'flex' : 'hidden lg:flex')}>
          {children}
        </section>
      </div>
    </ConversationsProvider>
  );
}
