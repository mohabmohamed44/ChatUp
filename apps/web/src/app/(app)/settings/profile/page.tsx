'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Loader2,
  LogOut,
  Mail,
  Pencil,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/shared/providers/AuthProvider';
import { useLocale } from '@/shared/providers/LocaleProvider';
import { useToast } from '@/shared/providers/ToastProvider';
import { me } from '@/features/auth/api';
import { useImageUpload } from '@/features/chat/hooks/useImageUpload';
import { LanguageToggle } from '@/shared/components/LanguageToggle';
import { initialsOf } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import type { AuthUser } from '@chatup/shared';
import { LIMITS } from '@chatup/shared';

export default function ProfilePage() {
  const router = useRouter();
  const { user: cachedUser, logout, updateAvatar } = useAuth();
  const { locale } = useLocale();
  const toast = useToast();

  const [user, setLocalUser] = useState<AuthUser | null>(cachedUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    cachedUser?.avatarUrl ?? null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    upload,
    uploading,
    progress,
    error: uploadError,
    reset: resetUpload,
  } = useImageUpload();

  // Fetch fresh profile from /auth/me on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    me()
      .then(({ user }: { user: AuthUser | null }) => {
        if (cancelled) return;
        setLocalUser(user ?? null);
        setAvatarUrl(user?.avatarUrl ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load profile');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  function openFilePicker() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject types the backend cannot store (magic-byte allowlist) before
    // uploading, so the user gets an instant message instead of a 400.
    if (!(LIMITS.IMAGE_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      toast.showToast('Please choose a JPEG, PNG, WebP or GIF image', { variant: 'warning', duration: 3000 });
      return;
    }

    // Show a local preview immediately
    const localPreview = URL.createObjectURL(file);
    const previousAvatarUrl = avatarUrl;
    setAvatarUrl(localPreview);

    // 1. Upload the image → get an attachment ID
    const result = await upload(file);
    if (!result) {
      URL.revokeObjectURL(localPreview);
      setAvatarUrl(previousAvatarUrl);
      toast.showToast('Failed to upload image', { variant: 'error', duration: 3000 });
      resetUpload();
      return;
    }

    // 2. Persist as the user's avatar
    try {
      const updated = await updateAvatar({
        avatarMediaId: result.attachmentId,
      });

      setAvatarUrl(updated.avatarUrl ?? localPreview);
      toast.showToast('Avatar updated', { variant: 'success' , duration: 3000});
    } catch (err: unknown) {
      URL.revokeObjectURL(localPreview);
      setAvatarUrl(previousAvatarUrl);
      toast.showToast('Failed to update avatar', { variant: 'error', duration: 3000 });
    } finally {
      resetUpload();
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (loading && !user) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading profile…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50 p-6">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!user) return null;

  const memberSince = new Date(user.createdAt).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
    { year: 'numeric', month: 'long' },
  );

  return (
    <div className="flex min-h-screen h-full flex-col overflow-y-auto bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link
          href="/conversations"
          aria-label="Back"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden="true" />
        </Link>
        <h1 className="text-base font-semibold text-slate-900">Profile</h1>
        <div className="flex-1" />
        <LanguageToggle />
      </header>

      <div className="mx-auto w-full max-w-md space-y-4 px-4 py-6">
        {/* Avatar with edit (pen) button */}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="relative">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-indigo-100 text-3xl font-semibold text-indigo-700">
                {initialsOf(user.displayName)}
              </span>
            )}

            {/* Pen badge */}
            <button
              type="button"
              onClick={openFilePicker}
              disabled={uploading}
              aria-label={user.avatarUrl ? 'Change avatar' : 'Add avatar'}
              className={cn(
                'absolute -bottom-1 flex h-8 w-8 items-center justify-center rounded-full',
                'bg-indigo-600 text-white shadow-lg ring-2 ring-white',
                'transition-colors hover:bg-indigo-500',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/40',
                'disabled:cursor-not-allowed disabled:opacity-70',
                'end-[-4px]',
              )}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {uploading ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Uploading… {progress}%
            </p>
          ) : uploadError ? (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {uploadError}
            </p>
          ) : null}

          <p className="text-lg font-semibold text-slate-900">
            {user.displayName}
          </p>
        </div>

        {/* Email */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <Mail className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </p>
            <p className="truncate text-sm text-slate-700">{user.email}</p>
          </div>
        </div>

        {/* Display name */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <UserIcon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Display name
            </p>
            <p className="truncate text-sm text-slate-700">{user.displayName}</p>
          </div>
        </div>

        {/* Member since */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <Calendar className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Member since
            </p>
            <p className="text-sm text-slate-700">{memberSince}</p>
          </div>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white py-3 text-sm font-medium text-red-600',
            'transition-colors hover:bg-red-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2',
          )}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </button>
      </div>
    </div>
  );
}