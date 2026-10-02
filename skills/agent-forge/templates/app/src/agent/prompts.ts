/**
 * Prompt loader. Prompts are versioned files in /prompts; their sha256 goes into every trace
 * span and eval cassette, so any change to a prompt is visible and re-evaluated (BU-16).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Parsed prompt identity, version, content hash and renderer; rendering rejects missing declared variables. */
export type Prompt = {
  name: string;
  version: string;
  hash: string;
  render: (vars: Record<string, string>) => string;
};

const cache = new Map<string, Prompt>();

/** Parse `---` frontmatter (flat `key: value`) and body. */
export function parsePrompt(name: string, text: string): Prompt {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`prompts/${name}.md: missing frontmatter`);
  const meta = Object.fromEntries(
    (m[1] ?? '').split('\n').flatMap((l) => {
      const kv = l.match(/^([a-z]+):\s*(.*)$/);
      return kv ? [[kv[1], kv[2]]] : [];
    }),
  ) as Record<string, string>;
  const body = (m[2] ?? '').trim();
  const declared = (meta.variables ?? '')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const used = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((x) => x[1] as string))];
  const undeclared = used.filter((v) => !declared.includes(v));
  if (undeclared.length)
    throw new Error(`prompts/${name}.md uses undeclared variables: ${undeclared.join(', ')}`);
  return {
    name,
    version: meta.version ?? '0',
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
    render: (vars) => {
      const missing = declared.filter((v) => vars[v] === undefined);
      if (missing.length) throw new Error(`prompts/${name}.md: missing variables ${missing.join(', ')}`);
      return body.replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? '');
    },
  };
}

/** Read and validate a named Markdown prompt from the supplied directory. Cache by directory/name only in production; filesystem and parse errors propagate. */
export function loadPrompt(name: string, dir = join(process.cwd(), 'prompts')): Prompt {
  const key = `${dir}/${name}`;
  const hit = cache.get(key);
  if (hit && process.env.NODE_ENV === 'production') return hit;
  const prompt = parsePrompt(name, readFileSync(join(dir, `${name}.md`), 'utf8'));
  cache.set(key, prompt);
  return prompt;
}
