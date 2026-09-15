'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { LIMITS, loginSchema } from '@chatup/shared';
import { ApiError } from '../../../shared/lib/api';
import { useAuth } from '../hooks/useAuth';
import { Mail, Lock, EyeClosed, Eye } from 'lucide-react';

const API_ERROR_ID = 'login-form-error';
const EMAIL_ERROR_ID = 'login-email-error';
const PASSWORD_ERROR_ID = 'login-password-error';
const PASSWORD_ID = 'login-password';

type LoginFieldErrors = Partial<Record<'email' | 'password', string>>;

const fieldClassName =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/15 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-500/15';

const iconClassName = 'pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400';

const fieldErrorClassName = 'mt-1.5 text-xs text-red-600';

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError(null);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const errors: LoginFieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if ((key === 'email' || key === 'password') && !errors[key]) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      if (errors.email) emailRef.current?.focus();
      else if (errors.password) passwordRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await login(result.data);
      router.replace('/conversations');
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <div className="relative">
          <Mail size={20} className={iconClassName} />
          <input
            ref={emailRef}
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="Enter your email address"
            required
            spellCheck={false}
            maxLength={LIMITS.EMAIL_MAX}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? EMAIL_ERROR_ID : undefined}
            className={fieldClassName}
          />
        </div>
        {fieldErrors.email ? (
          <p id={EMAIL_ERROR_ID} className={fieldErrorClassName}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={PASSWORD_ID} className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <div className="relative">
          <Lock size={20} className={iconClassName} />
          <input
            ref={passwordRef}
            id={PASSWORD_ID}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            maxLength={LIMITS.PASSWORD_MAX}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? PASSWORD_ERROR_ID : undefined}
            className={fieldClassName}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            aria-controls={PASSWORD_ID}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {showPassword ? (
              <Eye size={20} aria-hidden="true" />
            ) : (
              <EyeClosed size={20}  aria-hidden="true" />
            )}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id={PASSWORD_ERROR_ID} className={fieldErrorClassName}>
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      {apiError ? (
        <div
          id={API_ERROR_ID}
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span>{apiError}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
