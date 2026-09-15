'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { LIMITS, registerSchema } from '@chatup/shared';
import { ApiError } from '../../../shared/lib/api';
import { useAuth } from '../hooks/useAuth';
import { User, Mail, Lock, EyeClosed, Eye } from 'lucide-react';

const API_ERROR_ID = 'register-form-error';
const NAME_ERROR_ID = 'register-name-error';
const EMAIL_ERROR_ID = 'register-email-error';
const PASSWORD_ERROR_ID = 'register-password-error';
const PASSWORD_HINT_ID = 'register-password-hint';
const PASSWORD_ID = 'register-password';

type RegisterFieldErrors = Partial<Record<'displayName' | 'email' | 'password', string>>;

const fieldClassName =
  'w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/15 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-500/15';

const iconClassName = 'pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400';

const fieldErrorClassName = 'mt-1.5 text-xs text-red-600';

export function RegisterForm() {
  const { register } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiError(null);

    const result = registerSchema.safeParse({ email, password, displayName });
    if (!result.success) {
      const errors: RegisterFieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'displayName' || key === 'email' || key === 'password') &&
          !errors[key]
        ) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      if (errors.displayName) nameRef.current?.focus();
      else if (errors.email) emailRef.current?.focus();
      else if (errors.password) passwordRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await register(result.data);
      router.replace('/conversations');
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="register-name" className="block text-sm font-medium text-slate-700">
          Display name
        </label>
        <div className="relative">
          <User size={20} className={iconClassName} />
          <input
            ref={nameRef}
            id="register-name"
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder='Enter your display name'
            required
            maxLength={LIMITS.DISPLAY_NAME_MAX}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              if (fieldErrors.displayName) {
                setFieldErrors((prev) => ({ ...prev, displayName: undefined }));
              }
            }}
            aria-invalid={fieldErrors.displayName ? true : undefined}
            aria-describedby={fieldErrors.displayName ? NAME_ERROR_ID : undefined}
            className={fieldClassName}
          />
        </div>
        {fieldErrors.displayName ? (
          <p id={NAME_ERROR_ID} className={fieldErrorClassName}>
            {fieldErrors.displayName}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="register-email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <div className="relative">
          <Mail size={20} className={iconClassName} />
          <input
            ref={emailRef}
            id="register-email"
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
            autoComplete="new-password"
            required
            maxLength={LIMITS.PASSWORD_MAX}
            placeholder="Enter your password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={`${PASSWORD_HINT_ID}${fieldErrors.password ? ` ${PASSWORD_ERROR_ID}` : ''}`}
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
              <EyeClosed size={20} aria-hidden="true" />
            )}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id={PASSWORD_ERROR_ID} className={fieldErrorClassName}>
            {fieldErrors.password}
          </p>
        ) : (
          <p id={PASSWORD_HINT_ID} className="text-xs text-slate-500">
            At least {LIMITS.PASSWORD_MIN} characters.
          </p>
        )}
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
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
