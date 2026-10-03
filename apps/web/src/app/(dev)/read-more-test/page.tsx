'use client';
import { MessageBody } from '@/features/chat/components/MessageBody';

const cases: { label: string; text: string }[] = [
  { label: 'Short', text: 'Hello' },
  { label: '300 chars', text: 'a'.repeat(300) },
  { label: '301 chars', text: 'a'.repeat(301) },
  { label: 'Normal long', text: 'The quick brown fox '.repeat(30) },
  { label: 'URL', text: 'https://example.com/' + 'a'.repeat(200) },
  { label: 'Arabic long', text: 'السلام عليكم ورحمة الله وبركاته '.repeat(20) },
  { label: 'Mixed', text: 'Hello مرحبا '.repeat(40) },
  { label: 'Newlines', text: 'Line 1\nLine 2\n'.repeat(50) },
  { label: 'Emoji', text: '😀'.repeat(400) },
];

export default function ReadMoreTestPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      {cases.map((c, i) => (
        <div key={i} className="rounded-2xl bg-white p-3 shadow">
          <p className="mb-1 text-xs text-slate-400">
            #{i + 1} — {c.label}
          </p>
          <MessageBody text={c.text} isOwn={false} />
        </div>
      ))}
    </div>
  );
}