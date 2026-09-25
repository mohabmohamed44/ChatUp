export const TRUNCATE_AT = 300;

export type Direction = 'ltr' | 'rtl' | 'auto';

export type DirectionInfo = {
  dir: Direction;
  hasLatin: boolean;
  hasArabic: boolean;
  hasMixed: boolean;
};

const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;
const ARABIC_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Returns the base direction of a string, plus script flags.
 * Base direction is determined by the FIRST strong character.
 * Neutral characters (digits, emoji, punctuation) do not count.
 */
export function analyzeDirection(text: string): DirectionInfo {
  const hasLatin = LATIN_RE.test(text);
  const hasArabic = ARABIC_RE.test(text);

  let dir: Direction = 'auto';
  for (const char of text) {
    if (LATIN_RE.test(char)) { dir = 'ltr'; break; }
    if (ARABIC_RE.test(char)) { dir = 'rtl'; break; }
  }

  return {
    dir,
    hasLatin,
    hasArabic,
    hasMixed: hasLatin && hasArabic,
  };
}

/**
 * Truncates at a word boundary. Handles emoji and combining characters
 * by operating on grapheme clusters.
 */
export function truncate(text: string, limit = TRUNCATE_AT): {
  text: string;
  isTruncated: boolean;
} {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...segmenter.segment(text)].map((s) => s.segment);

  if (segments.length <= limit) return { text, isTruncated: false };

  // Every index below is a grapheme index. Mixing them with UTF-16 string
  // lengths (as window.lastIndexOf did) shifts the cut point for Arabic
  // diacritics and emoji, whose graphemes span multiple code units.
  const windowSegments = segments.slice(0, limit);
  const lastSpace = windowSegments.findLastIndex((segment) => segment === ' ');

  const cutAt = lastSpace > limit - 30 ? lastSpace : limit;

  return {
    text: windowSegments.slice(0, cutAt).join('').trimEnd() + '…',
    isTruncated: true,
  };
}

/**
 * True if the string is one long unbreakable token (a URL, a hash).
 */
export function isUnbreakable(text: string, threshold = 60): boolean {
  const trimmed = text.trim();
  return trimmed.length > threshold && !trimmed.includes(' ');
}