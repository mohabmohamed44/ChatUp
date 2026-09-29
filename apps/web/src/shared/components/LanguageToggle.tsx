'use client';

import { Languages } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLocale } from '@/shared/providers/LocaleProvider';

/**
 * Language toggle button.
 *
 * Directional utilities are authored with `ltr:` / `rtl:` variant prefixes so a
 * single class list adapts to the active locale. This pattern is used across the
 * chat UI (for example, presence dots use `ltr:right-0 rtl:left-0`). Swapping the
 * class list by `dir` at runtime with `cn(...)` does NOT work here because
 * `tailwind-merge` treats `ltr:` / `rtl:` prefixed classes as distinct from their
 * physical counterparts rather than as conflicting duplicates.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, dir, toggle } = useLocale();
  const label = dir === 'rtl' ? 'Switch to English' : 'Switch to Arabic';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      lang={locale}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5',
        'text-xs font-medium text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-800',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        className,
      )}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="fa-latin" aria-hidden="true">
        {locale === 'ar' ? 'English' : 'العربية'}
      </span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
