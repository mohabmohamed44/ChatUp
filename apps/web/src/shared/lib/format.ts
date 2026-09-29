export type Locale = 'en' | 'ar';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Arabic UI uses Western digits (`10:35`) by default, matching WhatsApp and
 * Telegram. Swap to `ar-EG` if you want Arabic-Indic numerals (`١٠:٣٥`).
 */
function localeTag(locale: Locale): string {
  return locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
}

/**
 * Formatters are cached per locale — Intl construction is expensive and this
 * runs on every render of every message.
 */
const timeCache = new Map<string, Intl.DateTimeFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();
const weekdayCache = new Map<string, Intl.DateTimeFormat>();
const fullCache = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(locale: Locale): Intl.DateTimeFormat {
  const tag = localeTag(locale);
  let f = timeCache.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', hour12: true });
    timeCache.set(tag, f);
  }
  return f;
}

function dateFormatter(locale: Locale): Intl.DateTimeFormat {
  const tag = localeTag(locale);
  let f = dateCache.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' });
    dateCache.set(tag, f);
  }
  return f;
}

function weekdayFormatter(locale: Locale): Intl.DateTimeFormat {
  const tag = localeTag(locale);
  let f = weekdayCache.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { weekday: 'short' });
    weekdayCache.set(tag, f);
  }
  return f;
}

function fullDateFormatter(locale: Locale): Intl.DateTimeFormat {
  const tag = localeTag(locale);
  let f = fullCache.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    fullCache.set(tag, f);
  }
  return f;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function yesterdayLabel(locale: Locale): string {
  return locale === 'ar' ? 'أمس' : 'Yesterday';
}

function nowLabel(locale: Locale): string {
  return locale === 'ar' ? 'الآن' : 'Now';
}

function minutesLabel(minutes: number, locale: Locale): string {
  if (locale === 'ar') {
    if (minutes === 1) return 'دقيقة';
    if (minutes === 2) return 'دقيقتان';
    return `${minutes} د`;
  }
  return `${minutes}m`;
}

/**
 * Short stamp for conversation rows.
 *
 *   < 1 min          → "Now" / "الآن"
 *   < 1 hour         → "5m" / "5 د"
 *   Today            → "10:35 AM"
 *   Yesterday        → "Yesterday" / "أمس"
 *   Within last week → "Mon" / "الإثنين"
 *   Older            → "Sep 24" / "٢٤ سبتمبر"
 */
export function formatListTimestamp(iso: string, locale: Locale = 'en'): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs >= 0 && diffMs < MINUTE_MS) return nowLabel(locale);
  if (diffMs >= 0 && diffMs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / MINUTE_MS));
    return minutesLabel(minutes, locale);
  }

  if (isSameDay(date, now)) return timeFormatter(locale).format(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return yesterdayLabel(locale);

  const startOfWindow = new Date(now);
  startOfWindow.setDate(now.getDate() - 6);
  startOfWindow.setHours(0, 0, 0, 0);
  if (date >= startOfWindow) return weekdayFormatter(locale).format(date);

  return dateFormatter(locale).format(date);
}

/**
 * Stamp used inside message bubbles.
 *
 *   Today            → "10:35 AM" / "١٠:٣٥ ص"
 *   Yesterday        → "Yesterday 10:35 AM" / "أمس ١٠:٣٥ ص"
 *   Within last week → "Mon 10:35 AM" / "الإثنين ١٠:٣٥ ص"
 *   Older            → "Sep 24" / "٢٤ سبتمبر"
 */
export function formatBubbleTimestamp(iso: string, locale: Locale = 'en'): string {
  const date = new Date(iso);
  const now = new Date();

  if (isSameDay(date, now)) return timeFormatter(locale).format(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `${yesterdayLabel(locale)} ${timeFormatter(locale).format(date)}`;
  }

  const startOfWindow = new Date(now);
  startOfWindow.setDate(now.getDate() - 6);
  startOfWindow.setHours(0, 0, 0, 0);
  if (date >= startOfWindow) {
    return `${weekdayFormatter(locale).format(date)} ${timeFormatter(locale).format(date)}`;
  }

  return dateFormatter(locale).format(date);
}

/**
 * Backwards-compatible alias. Prefer `formatBubbleTimestamp`.
 */
export function formatMessageTime(iso: string, locale: Locale = 'en'): string {
  return formatBubbleTimestamp(iso, locale);
}

/**
 * Full stamp for tooltips and accessible titles.
 *
 *   English → "Thursday, September 24, 2026 at 10:35 AM"
 *   Arabic  → "الخميس، ٢٤ سبتمبر ٢٠٢٦ في ١٠:٣٥ ص"
 */
export function formatFullTimestamp(iso: string, locale: Locale = 'en'): string {
  return fullDateFormatter(locale).format(new Date(iso));
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '';
  return `${first}${last}`.toUpperCase();
}