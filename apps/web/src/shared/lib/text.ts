import { LinkifyIt } from 'linkify-it';

const linkify = new LinkifyIt();

// Only http/https and bare domains linkify. Turn off fuzzy email and IP
// detection to reduce false positives (`user@example.com`, `192.168.1.1`).
linkify.set({
  fuzzyLink: true,
  fuzzyEmail: false,
  fuzzyIP: false,
});


linkify.add('ftp:');
linkify.add('mailto:');
linkify.add('//');

export const TRUNCATE_AT = 300;

export type Direction = 'ltr' | 'rtl' | 'auto';

export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

export type DirectionInfo = {
  dir: Direction;
  hasLatin: boolean;
  hasArabic: boolean;
  hasMixed: boolean;
};



// Latin letters including extended ranges (À-ɏ, Latin-1 supplement + extended-A/B)
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;

// Hebrew, Arabic, Arabic supplement, Arabic extended-A,
// Hebrew/Arabic presentation forms
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
    if (LATIN_RE.test(char)) {
      dir = 'ltr';
      break;
    }
    if (ARABIC_RE.test(char)) {
      dir = 'rtl';
      break;
    }
  }

  return {
    dir,
    hasLatin,
    hasArabic,
    hasMixed: hasLatin && hasArabic,
  };
}

/**
 * Truncates at a word boundary in grapheme space (so emoji and Arabic
 * combining marks are never split), and never ends mid-link.
 *
 * Returns the truncated text with a trailing ellipsis, or the original
 * text unchanged if it fits within the limit.
 */
export function truncate(
  text: string,
  limit = TRUNCATE_AT,
): { text: string; isTruncated: boolean } {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [...segmenter.segment(text)].map((s) => s.segment);

  if (graphemes.length <= limit) {
    return { text, isTruncated: false };
  }

  // Work in grapheme space for the cut position.
  // Indices here are grapheme indices, never UTF-16 string indices.
  const windowGraphemes = graphemes.slice(0, limit);
  const lastSpaceGraphemeIndex = windowGraphemes.findLastIndex((g) => g === ' ');

  const cutAt =
    lastSpaceGraphemeIndex > limit - 30 ? lastSpaceGraphemeIndex : limit;

  const previewBody = windowGraphemes.slice(0, cutAt).join('').trimEnd();

  // Convert grapheme cut to UTF-16 code-unit offset for linkify comparison.
  // linkify-it returns match.index / match.lastIndex in UTF-16 code units.
  const cutCu = previewBody.length;

  // If the cut point lands strictly inside a link, back off to before the
  // link starts — never render half a URL.
  const matches = linkify.match(text);
  if (matches) {
    const overlapping = matches.find((m) => m.index < cutCu && cutCu < m.lastIndex);
    if (overlapping) {
      const beforeLink = text.slice(0, overlapping.index).trimEnd();
      if (beforeLink.length > 0) {
        return { text: beforeLink + '…', isTruncated: true };
      }
      // The link fills the whole window; fall through to the grapheme cut.
    }
  }
  // before returning isTruncated, check
  if (isUnbreakable(text)) {
    return { text, isTruncated: false };
  }

  return { text: previewBody + '…', isTruncated: true };
}

/**
 * True if the string is one long unbreakable token (a URL, a hash).
 * Used to apply `break-all` so the token wraps inside the bubble.
 */
export function isUnbreakable(text: string, threshold = 60): boolean {
  const trimmed = text.trim();
  return trimmed.length > threshold && !trimmed.includes(' ');
}



/**
 * Splits a string into plain-text and link segments.
 * Only http/https and bare domains become clickable.
 *
 * linkify-it returns UTF-16 code-unit offsets, and String.prototype.slice
 * uses the same units, so the ranges are always consistent.
 */
export function segmentText(text: string): TextSegment[] {
  const matches = linkify.match(text);
  if (!matches || matches.length === 0) {
    return [{ type: 'text', value: text }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, match.index) });
    }

    // Double-check the scheme before rendering. Defense in depth:
    // linkify already blocks non-http schemes, but this ensures it.
    const isSafe = /^https?:\/\//i.test(match.url);
    if (isSafe) {
      segments.push({
        type: 'link',
        value: match.text,
        href: match.url,
      });
    } else {
      segments.push({ type: 'text', value: match.text });
    }

    cursor = match.lastIndex;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments;
}