import type { Metadata } from 'next';
import Link from 'next/link';
import { RegisterForm } from '@/features/auth';
import { MessagesSquare } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Create account | ChatUp',
};

export default function RegisterPage() {
  return (
    <section aria-labelledby="register-heading" className="w-full">
      <div className="mb-8 flex justify-center lg:hidden">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/30">
          <MessagesSquare size={24}/>
        </span>
      </div>

      <header className="mb-8 text-center">
        <h1
          id="register-heading"
          className="text-[1.75rem] font-bold leading-tight tracking-tight text-slate-900"
        >
          Create your account
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          A few details and you are ready to chat.
        </p>
      </header>

      <RegisterForm />

      <p className="mt-8 text-center text-sm text-slate-500">
        Already have an account?
        <Link
          href="/login"
          className="ml-1 rounded font-semibold text-indigo-600 underline-offset-4 hover:text-indigo-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </p>
    </section>
  );
}
