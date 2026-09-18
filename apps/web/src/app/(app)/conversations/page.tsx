import { MessageSquare } from 'lucide-react';

export default function ConversationsIndexPage() {
  return (
    <div className="hidden h-full w-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center lg:flex">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm"
      >
        <MessageSquare className="h-7 w-7" />
      </span>
      <h1 className="text-lg font-semibold text-slate-800">Select a conversation</h1>
      <p className="max-w-xs text-sm text-slate-500">
        Choose a chat from the list or start a new one to begin messaging.
      </p>
    </div>
  );
}
