const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Short stamp for conversation rows: time today, "Yesterday", weekday this week, else a date. */
export function formatListTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (isSameDay(date, now)) return timeFormatter.format(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';

  const startOfWindow = new Date(now);
  startOfWindow.setDate(now.getDate() - 6);
  startOfWindow.setHours(0, 0, 0, 0);
  if (date >= startOfWindow) return weekdayFormatter.format(date);

  return dateFormatter.format(date);
}

/** Time-only stamp used inside message bubbles. */
export function formatMessageTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** Full stamp for tooltips and accessible titles. */
export function formatFullTimestamp(iso: string): string {
  return fullDateFormatter.format(new Date(iso));
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '';
  return `${first}${last}`.toUpperCase();
}
