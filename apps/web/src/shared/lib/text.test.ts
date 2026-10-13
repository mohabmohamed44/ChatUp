import { describe, expect, it } from 'vitest';
import { analyzeDirection, isUnbreakable, segmentText, truncate } from './text';

describe('analyzeDirection', () => {
  it('detects Latin text as ltr', () => {
    const info = analyzeDirection('hello world');
    expect(info.dir).toBe('ltr');
    expect(info.hasLatin).toBe(true);
    expect(info.hasArabic).toBe(false);
    expect(info.hasMixed).toBe(false);
  });

  it('detects Arabic text as rtl', () => {
    const info = analyzeDirection('مرحبا بالعالم');
    expect(info.dir).toBe('rtl');
    expect(info.hasLatin).toBe(false);
    expect(info.hasArabic).toBe(true);
    expect(info.hasMixed).toBe(false);
  });

  it('uses the first strong character and flags mixed content', () => {
    const latinFirst = analyzeDirection('hello مرحبا');
    expect(latinFirst.dir).toBe('ltr');
    expect(latinFirst.hasMixed).toBe(true);

    const arabicFirst = analyzeDirection('مرحبا hello');
    expect(arabicFirst.dir).toBe('rtl');
    expect(arabicFirst.hasMixed).toBe(true);
  });

  it('returns auto when there are no strong characters', () => {
    expect(analyzeDirection('123 🚀 …').dir).toBe('auto');
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    const result = truncate('hello', 100);
    expect(result).toEqual({ text: 'hello', isTruncated: false });
  });

  it('truncates long text with an ellipsis', () => {
    const result = truncate('word '.repeat(100), 50);
    expect(result.isTruncated).toBe(true);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.length).toBeLessThan('word '.repeat(100).length);
  });

  it('never ends mid-link', () => {
    const text = `read this https://example.com/some/very/long/article/path and more words`;
    const result = truncate(text, 30);
    expect(result.isTruncated).toBe(true);
    expect(result.text).not.toContain('https://example.com/some');
  });
});

describe('isUnbreakable', () => {
  it('flags a long token without spaces', () => {
    expect(isUnbreakable('a'.repeat(61))).toBe(true);
  });

  it('passes text containing spaces', () => {
    expect(isUnbreakable(`${'a'.repeat(40)} ${'b'.repeat(40)}`)).toBe(false);
  });

  it('passes short tokens', () => {
    expect(isUnbreakable('short')).toBe(false);
  });
});

describe('segmentText', () => {
  it('returns plain text as a single segment', () => {
    expect(segmentText('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });

  it('splits out http links', () => {
    const segments = segmentText('visit https://example.com now');
    expect(segments).toContainEqual({
      type: 'link',
      value: 'https://example.com',
      href: 'https://example.com',
    });
    expect(segments[0]).toEqual({ type: 'text', value: 'visit ' });
    expect(segments[segments.length - 1]).toEqual({ type: 'text', value: ' now' });
  });

  it('does not linkify bare emails', () => {
    expect(segmentText('mail user@example.com')).toEqual([
      { type: 'text', value: 'mail user@example.com' },
    ]);
  });
});
