import { MessagesSquare } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-white">
      <aside
        aria-hidden="true"
        className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 p-10 lg:flex xl:w-[52%] xl:p-14"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-sky-300/20 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur">
          <MessagesSquare size={20} />
          </span>
          <span className="text-xl font-semibold tracking-tight text-white">ChatUp</span>
        </div>

        <div className="relative z-10 space-y-4">
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white/15 px-4 py-3 text-sm text-white backdrop-blur">
            Hey! Have you tried the new ChatUp app?
          </div>
          <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
            Yes! Messages show up instantly, even on slow connections.
          </div>
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white/15 px-4 py-3 text-sm text-white backdrop-blur">
            Texts, photos and voice notes — all in one place.
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xl font-medium leading-snug text-white xl:text-2xl">
            Real-time messaging that keeps up with you.
          </p>
          <p className="mt-3 text-sm text-indigo-100">
            Free to try. Your conversations stay yours.
          </p>
        </div>
      </aside>

      <main className="flex w-full items-center justify-center bg-white px-4 py-10 sm:px-6 lg:w-1/2 xl:w-[48%]">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}
