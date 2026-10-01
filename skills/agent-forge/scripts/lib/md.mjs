// Minimal Markdown reader for agent-forge artifacts (AGENT_SPEC.md, ARCHITECTURE-like files).
// Why hand-rolled: the toolkit ships with zero npm dependencies so it runs in any skill
// install (Claude Code plugin, Hermes, npx skills) without an install step.

/**
 * Split a document into YAML-ish frontmatter (flat `key: value` only) and body.
 * @param {string} text
 * @returns {{ meta: Record<string, string>, body: string, bodyStartLine: number }}
 */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { meta: {}, body: text, bodyStartLine: 1 };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { meta: {}, body: text, bodyStartLine: 1 };
  const meta = {};
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 };
}

/**
 * Strip HTML comments so template guidance never counts as an answer.
 * @param {string} text
 */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Index `## <id> ...` sections. The id is the first word of the heading, lower-cased,
 * so prose after it may be in any language.
 * @param {string} body
 * @returns {Map<string, { title: string, content: string, line: number }>}
 */
export function sections(body) {
  const out = new Map();
  const lines = body.split(/\r?\n/);
  let current = null;
  lines.forEach((line, i) => {
    const h = line.match(/^##\s+(\S+)(.*)$/);
    if (h) {
      current = { title: (h[1] + h[2]).trim(), content: '', line: i + 1 };
      out.set(h[1].toLowerCase(), current);
    } else if (current) {
      current.content += `${line}\n`;
    }
  });
  return out;
}

/**
 * Read `Key: value` lines inside a section. Keys are case-insensitive.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function fields(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * Parse the first GitHub-style pipe table in a section.
 * Header names are lower-cased; the separator row is skipped.
 * @param {string} content
 * @returns {Array<Record<string, string>>}
 */
export function table(content) {
  const rows = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'));
  if (rows.length < 2) return [];
  const cells = (row) =>
    row
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
  const header = cells(rows[0]).map((h) => h.toLowerCase());
  return rows
    .slice(1)
    .filter((r) => !/^\|[\s:|-]+\|$/.test(r))
    .map((r) => Object.fromEntries(cells(r).map((c, i) => [header[i] ?? `col${i}`, c])));
}

/** True when a value is empty or still a template placeholder like `<...>`. */
export function isBlank(value) {
  return value === undefined || value.trim() === '' || /^<[^>]*>$/.test(value.trim());
}
