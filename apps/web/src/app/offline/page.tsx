'use client';

export default function Offline() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <div className="max-w-md space-y-6">
        {/* Offline SVG Illustration */}
        <div className="flex justify-center">
          <div className="rounded-full bg-slate-100 p-6 shadow-inner">
            <img src="/no-connection.svg" alt="No Connection" className="h-24 w-24" />
          </div>
        </div>

        {/* Text Content */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            You&apos;re offline
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            ChatUp needs an active internet connection to send and receive messages. Please check your network settings and try again.
          </p>
        </div>

        {/* Retry Button */}
        <div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 active:scale-95"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}