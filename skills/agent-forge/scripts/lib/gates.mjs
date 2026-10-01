// Phase gates: the checkable completion criterion of every phase.
// grill/architect are validated here; build/evals/ui run the generated app's own
// `af:<phase>-gate` package script so the toolkit never hard-codes app commands.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArchitecture } from './architecture.mjs';
import { validateSpecFile } from './spec.mjs';
import { PHASES, phaseIndex, status, STATE_DIR } from './state.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHECKLIST = join(SKILL_DIR, 'references', 'gap-sweep.md');

/**
 * Run the gate for one phase.
 * @param {string} root project root
 * @param {string} phase
 * @param {{ run?: typeof spawnSync, now?: Date }} [deps]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function runGate(root, phase, deps = {}) {
  const run = deps.run ?? spawnSync;
  const spec = join(root, STATE_DIR, 'AGENT_SPEC.md');
  const arch = join(root, STATE_DIR, 'ARCHITECTURE.md');
  if (phaseIndex(phase) === -1) {
    return { ok: false, errors: [`ERROR: unknown phase "${phase}". Use one of: ${PHASES.map((p) => p.id).join(', ')}.`] };
  }
  if (phase === 'grill') {
    if (!existsSync(spec)) return { ok: false, errors: [`ERROR: ${STATE_DIR}/AGENT_SPEC.md not found. Run: af init`] };
    const errors = validateSpecFile(spec, CHECKLIST);
    return { ok: errors.length === 0, errors };
  }
  if (phase === 'architect') {
    if (!existsSync(arch)) return { ok: false, errors: [`ERROR: ${STATE_DIR}/ARCHITECTURE.md not found. Copy templates/ARCHITECTURE.md there and fill it.`] };
    const errors = validateArchitecture(readFileSync(arch, 'utf8'), readFileSync(spec, 'utf8'));
    return { ok: errors.length === 0, errors };
  }
  const script = `af:${phase}-gate`;
  const pkgPath = join(root, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
  if (!pkg?.scripts?.[script]) {
    return { ok: false, errors: [`ERROR: package.json has no "${script}" script. Scaffold the app from templates/app first (build phase step 1).`] };
  }
  const res = run('pnpm', ['run', '--silent', script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const ok = res.status === 0;
  const report = {
    phase, ok, exitCode: res.status, at: (deps.now ?? new Date()).toISOString(),
    tail: `${res.stdout ?? ''}${res.stderr ?? ''}`.split('\n').slice(-40).join('\n'),
  };
  const out = join(root, PHASES[phaseIndex(phase)].artifact);
  if (ok) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }
  return { ok, errors: ok ? [] : [`ERROR: "${script}" failed (exit ${res.status}). Fix the failures below, then re-run.`, report.tail] };
}

/**
 * Close a phase: earlier phases must be closed and this phase's gate must be green.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function closePhase(root, phase, deps = {}) {
  const st = status(root);
  const i = phaseIndex(phase);
  const blocking = st.phases.slice(0, Math.max(i, 0)).filter((p) => p.status !== 'closed');
  if (blocking.length) {
    return {
      ok: false,
      errors: blocking.map((p) => `ERROR: phase "${p.id}" is ${p.status}${p.changed.length ? ` (changed: ${p.changed.join(', ')})` : ''}. Close it first: /agent-forge-${p.id}`),
    };
  }
  return runGate(root, phase, deps);
}
