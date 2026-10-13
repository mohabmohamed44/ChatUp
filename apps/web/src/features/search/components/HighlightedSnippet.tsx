export function HighlightedSnippet({ html }: { html: string }) {
  const parts = html.split(/(<mark>.*?<\/mark>)/g);

  return (
    <span className="wrap-break-words">
      {parts.map((part, i) =>
        part.startsWith('<mark>') && part.endsWith('</mark>') ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">
            {part.slice(6, -7)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}
