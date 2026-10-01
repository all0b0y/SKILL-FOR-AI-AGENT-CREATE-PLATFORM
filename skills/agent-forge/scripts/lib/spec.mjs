// Validation of AGENT_SPEC.md — the grill phase artifact.
// Every error names the section and what to ask the user, so the agent can self-correct.
import { readFileSync } from 'node:fs';
import { fields, isBlank, parseFrontmatter, sections, stripComments, table } from './md.mjs';

const DIMENSIONS = [
  'goal', 'users', 'tools', 'autonomy', 'memory', 'risks', 'budget', 'evals', 'deployment', 'ui',
];
const REQUIRED_SECTIONS = ['case', 'resources', ...DIMENSIONS, 'rejected-tools', 'gap-sweep'];
const SURFACES = new Set(['chat', 'cron', 'webhook']);
const RISKS = new Set(['read', 'write', 'destructive']);
const MEMORY_KINDS = ['working', 'knowledge', 'facts'];
const MAX_CUSTOM_GAPS = 3;

/** Strip an accepted-default marker: `default: 20` → `20`. */
const value = (v) => (v ?? '').replace(/^default:\s*/i, '').trim();

/**
 * Read gap-sweep ids (`- **id** — ...`) from the checklist file.
 * @param {string} checklistText
 * @returns {string[]}
 */
export function gapIds(checklistText) {
  return [...checklistText.matchAll(/^- \*\*([a-z0-9-]+)\*\*/gm)].map((m) => m[1]);
}

/**
 * Validate a spec. Pure function: takes text, returns errors.
 * @param {string} specText
 * @param {string[]} requiredGapIds
 * @returns {string[]} error lines, each starting with `ERROR:`
 */
export function validateSpec(specText, requiredGapIds) {
  const errors = [];
  const err = (msg) => errors.push(`ERROR: ${msg}`);
  const { body } = parseFrontmatter(specText);
  const secs = sections(stripComments(body));

  for (const id of REQUIRED_SECTIONS) {
    if (!secs.has(id)) err(`section "## ${id}" missing. Copy it from templates/AGENT_SPEC.md.`);
  }
  const text = (id) => secs.get(id)?.content ?? '';
  const f = (id) => fields(text(id));
  const need = (id, key, hint) => {
    if (secs.has(id) && isBlank(value(f(id)[key.toLowerCase()]))) {
      err(`dimension "${id}": "${key}" is empty. ${hint}`);
    }
  };

  // case — the single open question.
  if (secs.has('case') && text('case').trim().length < 40) {
    err('section "case" is too short. Ask the user to describe where and why the agent works, on a live example.');
  }

  // resources — closed checklist.
  const resources = table(text('resources'));
  if (secs.has('resources') && resources.length === 0) {
    err('section "resources" has no rows. Run the resource inventory: APIs/keys, data sources, memory/DB, services, budget.');
  }
  resources.forEach((r) => {
    if (!['have', 'none'].includes(value(r.status))) {
      err(`resource "${r.resource}": status must be "have" or "none".`);
    }
  });

  need('goal', 'Metric', 'Ask: how do we know the agent works?');
  need('goal', 'Target', 'Ask for a numeric target for the metric.');

  need('users', 'Users', 'Ask who triggers the agent.');
  const surfaces = value(f('users').surfaces).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (secs.has('users')) {
    if (surfaces.length === 0) err('dimension "users": "Surfaces" is empty. Choose from chat, cron, webhook.');
    surfaces.filter((s) => !SURFACES.has(s)).forEach((s) => err(`dimension "users": unknown surface "${s}". Use chat, cron or webhook.`));
  }

  // tools — least privilege: every tool justified by a scenario.
  const tools = table(text('tools'));
  if (secs.has('tools') && tools.length === 0) {
    err('dimension "tools": no tools. A tool-less agent is rung 1 (single LLM call); record that choice with a reason in the table or add tools.');
  }
  const names = new Set();
  tools.forEach((t) => {
    const name = value(t.name);
    if (isBlank(name)) return err('dimension "tools": a row has an empty name.');
    if (!/^[a-z][a-z0-9_]*$/.test(name)) err(`tool "${name}": name must be snake_case (a-z, 0-9, _).`);
    if (names.has(name)) err(`tool "${name}" is listed twice.`);
    names.add(name);
    if (!RISKS.has(value(t.risk))) err(`tool "${name}": risk must be read, write or destructive.`);
    if (!/^(native|mcp:[a-z0-9_-]+)$/.test(value(t.source))) err(`tool "${name}": source must be "native" or "mcp:<server>".`);
    if (isBlank(value(t.scenario))) err(`tool "${name}": no scenario. Least privilege: name the scenario that needs it or move it to rejected-tools.`);
  });
  const services = new Set(tools.map((t) => value(t.source)));
  if (services.size > 1) {
    tools
      .filter((t) => !/^[a-z0-9]+_[a-z0-9_]+$/.test(value(t.name)))
      .forEach((t) => err(`tool "${value(t.name)}": tools come from ${services.size} services, so names need a service prefix (e.g. "helpdesk_ticket_create").`));
  }
  table(text('rejected-tools')).forEach((r) => {
    if (isBlank(value(r.reason))) err(`rejected tool "${r.name}": reason is empty.`);
  });

  // autonomy — finite loop.
  const steps = Number(value(f('autonomy')['max-steps']));
  if (secs.has('autonomy') && !(Number.isInteger(steps) && steps >= 1 && steps <= 100)) {
    err('dimension "autonomy": "Max-steps" must be an integer 1-100. Ask how many steps a run may take.');
  }
  const failures = Number(value(f('autonomy')['failure-threshold']));
  if (secs.has('autonomy') && !(Number.isInteger(failures) && failures >= 1)) {
    err('dimension "autonomy": "Failure-threshold" must be an integer >= 1.');
  }

  // memory — every kind decided, unused kinds not created.
  const memory = table(text('memory'));
  MEMORY_KINDS.forEach((kind) => {
    const row = memory.find((m) => value(m.kind) === kind);
    if (secs.has('memory') && !row) err(`dimension "memory": row "${kind}" missing.`);
    else if (row && !['yes', 'no'].includes(value(row.enabled))) err(`memory "${kind}": enabled must be yes or no.`);
    else if (row && isBlank(value(row.reason))) err(`memory "${kind}": reason is empty.`);
  });

  need('risks', 'Untrusted-sources', 'Ask which external content the agent reads (web, email, files, third-party tool output) or write "none".');
  const classifier = value(f('risks').classifier);
  if (secs.has('risks') && !/^(off|on:\s*\S.*)$/i.test(classifier)) {
    err('dimension "risks": "Classifier" must be "off" or "on: <risk from the interview>".');
  }

  need('budget', 'Baseline-model', 'Use the strongest available model until model-bench runs.');
  const cost = Number(value(f('budget')['max-cost-usd-per-run']));
  if (secs.has('budget') && !(cost > 0)) err('dimension "budget": "Max-cost-usd-per-run" must be a positive number.');
  const latency = Number(value(f('budget')['target-latency-ms']));
  if (secs.has('budget') && !(Number.isInteger(latency) && latency > 0)) err('dimension "budget": "Target-latency-ms" must be a positive integer.');

  // evals — 5-10 real cases from the interview.
  const evals = table(text('evals')).filter((e) => !isBlank(value(e.id)));
  if (secs.has('evals') && (evals.length < 5 || evals.length > 10)) {
    err(`dimension "evals": ${evals.length} cases; need 5-10 real input → expected-behaviour examples from the user.`);
  }
  evals.forEach((e) => {
    if (isBlank(value(e.input)) || isBlank(value(e.expected))) err(`eval "${e.id}": input and expected must both be filled.`);
  });

  const target = value(f('deployment').target).toLowerCase();
  if (secs.has('deployment') && !['docker', 'vercel'].includes(target)) err('dimension "deployment": "Target" must be docker or vercel.');
  const identity = value(f('deployment').identity).toLowerCase();
  if (secs.has('deployment') && !['local', 'trusted-header'].includes(identity)) {
    err('dimension "deployment": "Identity" must be local or trusted-header.');
  }
  if (target === 'vercel' && surfaces.some((s) => s !== 'chat')) {
    err(`deployment "vercel" cannot run background surfaces (${surfaces.filter((s) => s !== 'chat').join(', ')}). Choose docker, or drop those surfaces.`);
  }

  need('ui', 'Screens', 'Ask which screens the operator and users need.');
  need('ui', 'Tone', 'Ask for the brand tone in a few words.');

  // gap sweep — fixed checklist + up to 3 custom rows.
  const gaps = table(text('gap-sweep'));
  requiredGapIds.forEach((id) => {
    const row = gaps.find((g) => value(g.item) === id);
    if (secs.has('gap-sweep') && !row) err(`gap-sweep item "${id}" missing. Ask about it or mark "na" with a reason.`);
  });
  gaps.forEach((g) => {
    const id = value(g.item);
    if (!['answered', 'na'].includes(value(g.status))) err(`gap-sweep "${id}": status must be answered or na.`);
    if (isBlank(value(g.note))) err(`gap-sweep "${id}": note is empty; record the answer or why it does not apply.`);
    if (!requiredGapIds.includes(id) && !id.startsWith('custom-')) err(`gap-sweep "${id}": unknown item; extra items must start with "custom-".`);
  });
  const custom = gaps.filter((g) => value(g.item).startsWith('custom-')).length;
  if (custom > MAX_CUSTOM_GAPS) err(`gap-sweep has ${custom} custom items; keep at most ${MAX_CUSTOM_GAPS}, the case-specific ones that matter most.`);

  return errors;
}

/**
 * Validate spec and checklist files from disk.
 * @param {string} specPath
 * @param {string} checklistPath
 */
export function validateSpecFile(specPath, checklistPath) {
  return validateSpec(readFileSync(specPath, 'utf8'), gapIds(readFileSync(checklistPath, 'utf8')));
}

/** Tools from a spec, used by later phases to cross-check the registry. */
export function specTools(specText) {
  const secs = sections(stripComments(parseFrontmatter(specText).body));
  return table(secs.get('tools')?.content ?? '').map((t) => ({
    name: value(t.name), source: value(t.source), risk: value(t.risk), scenario: value(t.scenario),
  }));
}
