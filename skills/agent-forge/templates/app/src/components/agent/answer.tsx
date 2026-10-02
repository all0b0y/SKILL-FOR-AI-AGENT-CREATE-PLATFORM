import { Fragment } from 'react';

const CITATION = /\[([\w./-]+\.md)\]/g;

/** Assistant text with `[source.md]` citations rendered as distinct source chips (UI-06). */
export function Answer({ text }: { text: string }) {
  // Keyed by character offset: the text only grows, so earlier offsets stay stable.
  const parts: Array<{ at: number; text: string } | { at: number; source: string }> = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const at = m.index ?? 0;
    parts.push({ at: last, text: text.slice(last, at) });
    parts.push({ at, source: m[1] as string });
    last = at + m[0].length;
  }
  parts.push({ at: last, text: text.slice(last) });
  return (
    <p className="leading-relaxed whitespace-pre-wrap">
      {parts.map((p) =>
        'text' in p ? (
          <Fragment key={`t${p.at}`}>{p.text}</Fragment>
        ) : (
          <span
            key={`s${p.at}`}
            className="mx-0.5 inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 align-baseline font-mono text-[0.7rem] text-muted"
            title={`Source: ${p.source}`}
          >
            {p.source}
          </span>
        ),
      )}
    </p>
  );
}
