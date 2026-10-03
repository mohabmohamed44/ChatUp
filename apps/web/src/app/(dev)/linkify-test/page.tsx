'use client';

import { segmentText } from '@/shared/lib/text';

const cases = [
  // --- SHOULD BE LINKS ---
  'https://example.com',
  'http://example.com',
  'https://www.github.com',
  'www.github.com',
  'www.example.com',
  'example.com',
  'sub.example.com',
  'example.com/path',
  'example.com/path?query=1',
  'example.com/path#hash',
  'https://example.com:8080',
  'https://example.com:8080/path',
  'https://sub.domain.co.uk',
  'https://github.com/mohabmohamed44',
  'https://vjudge.net/problem/UVA-10653',
  'https://example.com/path-with-hyphen',
  'https://example.com/UPPERCASE',
  'https://example.com/123',
  'https://example.com/a/b/c/d/e',
  'https://example.com/path?x=1&y=2&z=3',
  'https://example.com/%20encoded',
  'https://xn--mgbh0fb.xn--kgbechtv',
  'Check this: https://example.com',
  '(https://example.com)',
  'مرحبا https://example.com',
  'https://example.com https://example.org',

  // --- SHOULD NOT BE LINKS ---
  'javascript:alert(1)',
  'data:text/html,<script>',
  'file:///etc/passwd',
  'vbscript:msgbox(1)',
  'ftp://example.com',
  'mailto:user@example.com',
  '//evil.com',
  'just some text',
  'no links here',
  '12345',
  'user@example.com',
  '192.168.1.1',
  'hello.example',        // fake TLD
  'not.a.domain.xyzabc',  // fake TLD
];

export default function LinkifyTestPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-2 p-6">
      <h1 className="mb-4 text-xl font-semibold">linkify-it test cases</h1>
      {cases.map((text, i) => {
        const segments = segmentText(text);
        const linkCount = segments.filter((s) => s.type === 'link').length;
        return (
          <div key={i} className="rounded border bg-white p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <span>#{i + 1}</span>
              <span className={linkCount > 0 ? 'text-green-600' : 'text-slate-400'}>
                {linkCount} link{linkCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="break-all">
              {segments.map((seg, j) =>
                seg.type === 'link' ? (
                  <a
                    key={j}
                    href={seg.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 underline"
                  >
                    {seg.value}
                  </a>
                ) : (
                  <span key={j}>{seg.value}</span>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}