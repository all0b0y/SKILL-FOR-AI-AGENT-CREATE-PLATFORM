// Recording interview answers into AGENT_SPEC.md and decisions.md without the agent re-reading them.
// Why: rewriting the spec by hand meant reading the whole growing file before every answer, which
// made the interview's context (and token cost) grow with the square of its length.
import { parseFrontmatter, sections, stripComments } from './md.mjs';

/** Sections whose answers are pipe-table rows, keyed by their first cell. */
export const TABLE_SECTIONS = new Set(['resources', 'tools', 'rejected-tools', 'memory', 'evals', 'gap-sweep']);

const PLACEHOLDER = /^<[^>]*>$/;
const oneLine = (s) => s.replace(/\s*\r?\n\s*/g, ' ').trim();
const cellsOf = (row) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * Locate `## <id>` in the document: [start line of the heading, end line (exclusive)].
 * @param {string[]} lines
 * @param {string} id
 */
function sectionRange(lines, id) {
  const start = lines.findIndex((l) => {
    const h = l.match(/^##\s+(\S+)/);
    return h && h[1].toLowerCase() === id;
  });
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return [start, end];
}

/**
 * Apply one answer to the spec text.
 *
 * Targets: `language` (frontmatter), `case` (prose; `append` adds a sentence), `<section>.<Field>`
 * (a `Field: value` line), or `<section>` for table sections (value is a row `a | b | c`, upserted
 * by its first cell; template placeholder rows are dropped).
 * @param {string} spec
 * @param {string} target
 * @param {string} value
 * @param {{ append?: boolean, by?: 'user' | 'default' }} [opts]
 * @returns {string}
 */
export function applyAnswer(spec, target, value, { append = false, by = 'user' } = {}) {
  const raw = value.trim();
  if (!raw) throw new Error('empty value');
  const t = target.trim();
  const lines = spec.split('\n');

  if (t.toLowerCase() === 'language') {
    const i = lines.findIndex((l, n) => n > 0 && /^language:/.test(l));
    if (i === -1 || !lines.slice(0, i).includes('---')) throw new Error('frontmatter "language:" not found');
    lines[i] = `language: ${oneLine(raw)}`;
    return lines.join('\n');
  }

  const [rawSection, field] = t.split('.', 2);
  const id = rawSection.toLowerCase();
  const range = sectionRange(lines, id);
  if (!range) {
    const known = [...sections(stripComments(parseFrontmatter(spec).body)).keys()].join(', ');
    throw new Error(`section "${id}" not found; sections: ${known}`);
  }
  const [start, end] = range;
  const body = lines.slice(start + 1, end);

  if (id === 'case' && !field) {
    const prose = body.filter((l) => !/^\s*<!--.*-->\s*$/.test(l)).join(' ').replace(/<!--[\s\S]*?-->/g, '').trim();
    const text = append && prose ? `${prose} ${oneLine(raw)}` : oneLine(raw);
    lines.splice(start + 1, end - start - 1, '', text);
    return lines.join('\n');
  }

  if (TABLE_SECTIONS.has(id)) {
    if (field) throw new Error(`"${id}" is a table; pass the whole row as the value: "${id}" "a | b | c"`);
    const tableLines = body.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
    if (tableLines.length < 2) throw new Error(`section "${id}" has no table header`);
    const width = cellsOf(tableLines[0][0]).length;
    const cells = cellsOf(raw);
    if (cells.length !== width) throw new Error(`"${id}" rows have ${width} cells (${cellsOf(tableLines[0][0]).join(' | ')}); got ${cells.length}`);
    const row = `| ${cells.join(' | ')} |`;
    const key = cells[0].toLowerCase();
    const rows = tableLines.slice(2);
    const same = rows.find(([l]) => cellsOf(l)[0].toLowerCase() === key);
    const placeholders = rows.filter(([l]) => PLACEHOLDER.test(cellsOf(l)[0]));
    if (same) body[same[1]] = row;
    else body.splice(tableLines[tableLines.length - 1][1] + 1, 0, row);
    const drop = new Set(placeholders.map(([, i]) => i));
    const kept = body.filter((_, i) => !drop.has(i) || (same && i === same[1]));
    lines.splice(start + 1, end - start - 1, ...kept);
    return lines.join('\n');
  }

  if (!field) throw new Error(`"${id}" has fields; target one as "${id}.<Field>"`);
  const text = oneLine(raw);
  const val = by === 'default' && !/^default:/i.test(text) ? `default: ${text}` : text;
  const existing = body.findIndex((l) => l.match(/^([A-Za-z][A-Za-z0-9-]*):/)?.[1].toLowerCase() === field.toLowerCase());
  if (existing !== -1) {
    const name = body[existing].split(':')[0];
    body[existing] = `${name}: ${val}`;
  } else {
    let last = -1;
    body.forEach((l, i) => {
      if (/^[A-Za-z][A-Za-z0-9-]*:/.test(l)) last = i;
    });
    body.splice(last === -1 ? body.length : last + 1, 0, `${field}: ${val}`);
  }
  lines.splice(start + 1, end - start - 1, ...body);
  return lines.join('\n');
}

/**
 * One decisions.md row for an answer.
 * @param {{ date: string, q?: string, target: string, value: string, why?: string, by?: string }} a
 */
export function decisionRow({ date, q, target, value, why, by = 'user' }) {
  const esc = (s) => oneLine(s).replace(/\|/g, '\\|');
  const reason = why ?? (by === 'default' ? 'User accepted the recommended option for this question.' : "User's answer.");
  return `| ${date} | ${q ? `${esc(q)}: ` : ''}${esc(target)} = ${esc(value)} | ${esc(reason)} | ${by} |`;
}

/**
 * One line per section, truncated: enough to resume the interview or show the shared summary
 * without loading the whole spec.
 * @param {string} spec
 * @param {number} [width]
 */
export function specSummary(spec, width = 160) {
  const { meta, body } = parseFrontmatter(spec);
  const out = [`language: ${meta.language ?? ''}`];
  for (const [id, s] of sections(stripComments(body))) {
    const rows = s.content.split('\n').map((l) => l.trim()).filter(Boolean);
    const tableRows = rows.filter((l) => l.startsWith('|')).slice(2);
    const text = TABLE_SECTIONS.has(id)
      ? `${tableRows.length} rows: ${tableRows.map((r) => cellsOf(r)[0]).join(', ')}`
      : rows.join(' · ');
    out.push(`${id}: ${text.length > width ? `${text.slice(0, width - 1)}…` : text || '(empty)'}`);
  }
  return out.join('\n');
}
