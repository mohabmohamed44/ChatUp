import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatBubbleTimestamp,
  formatFullTimestamp,
  formatListTimestamp,
  formatMessageTime,
  initialsOf,
} from './format';

// Relative construction: immune to the runner's timezone. Never build
// expectations around absolute wall-clock times.
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe('formatListTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Now" for messages under a minute old', () => {
    expect(formatListTimestamp(ago(30_000), 'en')).toBe('Now');
  });

  it('renders "الآن" for the Arabic locale', () => {
    expect(formatListTimestamp(ago(30_000), 'ar')).toBe('الآن');
  });

  it('renders minutes for messages under an hour old', () => {
    expect(formatListTimestamp(ago(5 * 60_000), 'en')).toBe('5m');
    expect(formatListTimestamp(ago(60_000), 'en')).toBe('1m');
  });

  it('renders Arabic minute forms', () => {
    expect(formatListTimestamp(ago(60_000), 'ar')).toBe('دقيقة');
    expect(formatListTimestamp(ago(2 * 60_000), 'ar')).toBe('دقيقتان');
    expect(formatListTimestamp(ago(5 * 60_000), 'ar')).toBe('5 د');
  });

  it('renders "Yesterday" for a message from the previous day', () => {
    expect(formatListTimestamp(ago(24 * 60 * 60_000), 'en')).toBe('Yesterday');
    expect(formatListTimestamp(ago(24 * 60 * 60_000), 'ar')).toBe('أمس');
  });

  it('renders a non-empty stamp for old messages', () => {
    expect(formatListTimestamp(ago(30 * 24 * 60 * 60_000), 'en').length).toBeGreaterThan(0);
  });
});

describe('formatBubbleTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a time-only stamp for today', () => {
    expect(formatBubbleTimestamp(ago(60_000), 'en').length).toBeGreaterThan(0);
  });

  it('prefixes yesterday stamps with the Yesterday label', () => {
    expect(formatBubbleTimestamp(ago(24 * 60 * 60_000), 'en').startsWith('Yesterday ')).toBe(true);
  });

  it('formatMessageTime stays an alias of formatBubbleTimestamp', () => {
    const iso = ago(2 * 60 * 60_000);
    expect(formatMessageTime(iso, 'en')).toBe(formatBubbleTimestamp(iso, 'en'));
  });

  it('formatFullTimestamp renders a non-empty stamp', () => {
    expect(formatFullTimestamp(ago(60_000), 'en').length).toBeGreaterThan(0);
  });
});

describe('initialsOf', () => {
  it('takes first + last initials', () => {
    expect(initialsOf('Alice Wonderland')).toBe('AW');
  });

  it('handles a single name', () => {
    expect(initialsOf('alice')).toBe('A');
  });

  it('falls back to ? for blank input', () => {
    expect(initialsOf('   ')).toBe('?');
  });

  it('ignores extra whitespace', () => {
    expect(initialsOf('  Alice   Bob  ')).toBe('AB');
  });
});
