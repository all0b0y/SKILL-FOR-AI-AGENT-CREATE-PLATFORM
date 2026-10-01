// Validation of ARCHITECTURE.md — the architect phase artifact — against AGENT_SPEC.md.
import { fields, isBlank, parseFrontmatter, sections, stripComments, table } from './md.mjs';
import { specTools } from './spec.mjs';

const REQUIRED = ['rung', 'tools', 'models', 'memory', 'limits', 'guardrails', 'runs', 'identity'];
const PATTERNS = new Set(['chaining', 'routing', 'parallelization', 'evaluator-optimizer']);

const value = (v) => (v ?? '').replace(/^default:\s*/i, '').trim();

/**
 * Cross-check an architecture document against the spec it was derived from.
 * @param {string} archText
 * @param {string} specText
 * @returns {string[]} `ERROR:` lines
 */
export function validateArchitecture(archText, specText) {
  const errors = [];
  const err = (msg) => errors.push(`ERROR: ${msg}`);
  const arch = sections(stripComments(parseFrontmatter(archText).body));
  const spec = sections(stripComments(parseFrontmatter(specText).body));
  for (const id of REQUIRED) if (!arch.has(id)) err(`section "## ${id}" missing. Copy it from templates/ARCHITECTURE.md.`);
  const f = (secs, id) => fields(secs.get(id)?.content ?? '');
  const t = (secs, id) => table(secs.get(id)?.content ?? '');

  // Complexity ladder: lowest sufficient rung, justified.
  const rung = Number.parseInt(value(f(arch, 'rung').rung), 10);
  if (arch.has('rung') && ![1, 2, 3, 4].includes(rung)) err('rung: "Rung" must be 1, 2, 3 or 4.');
  if (rung > 1 && isBlank(value(f(arch, 'rung')['why-not-lower']))) {
    err(`rung ${rung}: "Why-not-lower" is empty. State what rung ${rung - 1} cannot do for this case.`);
  }
  if (rung === 2 && !PATTERNS.has(value(f(arch, 'rung').pattern))) {
    err('rung 2: "Pattern" must be chaining, routing, parallelization or evaluator-optimizer.');
  }
  if (rung === 4 && isBlank(value(f(arch, 'rung')['multi-agent-justification']))) {
    err('rung 4: "Multi-agent-justification" is empty. Name parallel breadth, context overflow or tool overload and the eval failure behind it, or drop to rung 3.');
  }

  // Tool registry mirrors the spec exactly — same names, same risk; write/destructive need approval.
  const wanted = new Map(specTools(specText).map((x) => [x.name, x]));
  const rows = t(arch, 'tools');
  const seen = new Set();
  rows.forEach((row) => {
    const name = value(row.name);
    seen.add(name);
    const s = wanted.get(name);
    if (!s) return err(`tool "${name}" is not in AGENT_SPEC tools. Add it to the spec with a scenario (re-closes grill) or remove it.`);
    if (value(row.risk) !== s.risk) err(`tool "${name}": risk "${value(row.risk)}" differs from spec "${s.risk}".`);
    if (value(row.source) !== s.source) err(`tool "${name}": source "${value(row.source)}" differs from spec "${s.source}".`);
    if (['write', 'destructive'].includes(s.risk) && value(row.approval) !== 'yes') {
      err(`tool "${name}" is ${s.risk}: approval must be "yes" (human confirms before it runs).`);
    }
    const timeout = Number(value(row['timeout-ms']));
    if (!(Number.isInteger(timeout) && timeout > 0)) err(`tool "${name}": timeout-ms must be a positive integer.`);
    const retries = Number(value(row.retries));
    if (!(Number.isInteger(retries) && retries >= 0 && retries <= 5)) err(`tool "${name}": retries must be an integer 0-5.`);
    if (s.risk === 'destructive' && retries > 0) err(`tool "${name}" is destructive: retries must be 0 unless the operation is idempotent; set 0.`);
  });
  [...wanted.keys()].filter((n) => !seen.has(n)).forEach((n) => err(`spec tool "${n}" is missing from the architecture tools table.`));

  // Models: a main role on the spec's baseline model.
  const models = t(arch, 'models');
  const main = models.find((m) => value(m.role) === 'main');
  const baseline = value(f(spec, 'budget')['baseline-model']);
  if (arch.has('models') && !main) err('models: a row with role "main" is required.');
  else if (main && baseline && value(main.model) !== baseline) {
    err(`models: main model "${value(main.model)}" differs from spec baseline "${baseline}". Swap models only after model-bench (evals phase).`);
  }

  // Memory: exactly the kinds the spec enabled.
  const specMem = new Map(t(spec, 'memory').map((m) => [value(m.kind), value(m.enabled)]));
  t(arch, 'memory').forEach((m) => {
    const kind = value(m.kind);
    if (specMem.has(kind) && specMem.get(kind) !== value(m.enabled)) {
      err(`memory "${kind}": enabled "${value(m.enabled)}" differs from spec "${specMem.get(kind)}".`);
    }
  });

  // Limits copied from spec, never loosened.
  const pairs = [
    ['max-steps', f(spec, 'autonomy')['max-steps']],
    ['failure-threshold', f(spec, 'autonomy')['failure-threshold']],
    ['max-cost-usd-per-run', f(spec, 'budget')['max-cost-usd-per-run']],
  ];
  for (const [key, specValue] of pairs) {
    const a = Number(value(f(arch, 'limits')[key]));
    const s = Number(value(specValue));
    if (arch.has('limits') && a !== s) err(`limits: "${key}" is ${Number.isNaN(a) ? 'missing' : a}; spec says ${s}.`);
  }

  // Guardrails: three structural layers always on; classifier only when the spec asks.
  const layers = new Map(t(arch, 'guardrails').map((g) => [value(g.layer), value(g.enabled)]));
  for (const layer of ['structure', 'deterministic', 'limits']) {
    if (arch.has('guardrails') && layers.get(layer) !== 'yes') err(`guardrails: layer "${layer}" must be enabled.`);
  }
  const wantsClassifier = /^on/i.test(value(f(spec, 'risks').classifier));
  if (arch.has('guardrails') && (layers.get('classifier') === 'yes') !== wantsClassifier) {
    err(`guardrails: classifier must be ${wantsClassifier ? 'yes' : 'no'} to match spec risks.Classifier.`);
  }

  // Runs and identity mirror the spec.
  const norm = (s) => value(s).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(',');
  if (arch.has('runs') && norm(f(arch, 'runs').surfaces) !== norm(f(spec, 'users').surfaces)) {
    err('runs: "Surfaces" differ from spec users.Surfaces.');
  }
  if (arch.has('runs') && value(f(arch, 'runs').queue) !== 'pg-boss') err('runs: "Queue" must be pg-boss (fixed stack).');
  if (arch.has('runs') && isBlank(value(f(arch, 'runs').idempotency))) err('runs: "Idempotency" is empty. Name the dedupe key (e.g. webhook delivery id → pg-boss singletonKey).');
  if (arch.has('identity') && value(f(arch, 'identity').adapter) !== value(f(spec, 'deployment').identity)) {
    err('identity: "Adapter" differs from spec deployment.Identity.');
  }
  return errors;
}
