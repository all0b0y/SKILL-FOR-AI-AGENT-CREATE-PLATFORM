// Phase state machine for an agent-forge project.
// `.agent-forge/state.json` is written only here; a phase counts as closed only while
// the hashes recorded at close time still match the artifacts on disk.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const STATE_DIR = '.agent-forge';
export const STATE_FILE = `${STATE_DIR}/state.json`;

/** Ordered phases and the artifact each one must leave behind. */
export const PHASES = [
  { id: 'grill', artifact: `${STATE_DIR}/AGENT_SPEC.md` },
  { id: 'architect', artifact: `${STATE_DIR}/ARCHITECTURE.md` },
  { id: 'build', artifact: `${STATE_DIR}/reports/build.json` },
  { id: 'evals', artifact: `${STATE_DIR}/reports/evals.json` },
  { id: 'ui', artifact: `${STATE_DIR}/reports/ui.json` },
];

export const phaseIndex = (id) => PHASES.findIndex((p) => p.id === id);

/**
 * Walk up from `start` to the directory holding `.agent-forge/`.
 * @param {string} start
 * @returns {string | null}
 */
export function findProjectRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, STATE_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** sha256 of a file, or null when it does not exist. */
export function hashFile(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

export function readState(root) {
  return JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'));
}

export function writeState(root, state) {
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  writeFileSync(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export const emptyState = () => ({ version: 1, phases: {} });

/**
 * Status of every phase. A closed phase is `stale` when its own artifact or any earlier
 * phase's artifact changed after it closed — the spec edit that reopens downstream work.
 * @param {string} root
 * @returns {{ phases: Array<{ id: string, status: 'open'|'closed'|'stale', changed: string[] }>, current: string | null }}
 */
export function status(root) {
  const state = readState(root);
  const phases = PHASES.map((phase, i) => {
    const rec = state.phases[phase.id];
    if (!rec) return { id: phase.id, status: 'open', changed: [] };
    const changed = PHASES.slice(0, i + 1)
      .map((p) => p.artifact)
      .filter((a) => rec.hashes?.[a] !== hashFile(join(root, a)));
    return { id: phase.id, status: changed.length ? 'stale' : 'closed', changed };
  });
  // A phase after an open/stale one cannot count as closed.
  let blocked = false;
  for (const p of phases) {
    if (blocked && p.status === 'closed') p.status = 'stale';
    if (p.status !== 'closed') blocked = true;
  }
  const current = phases.find((p) => p.status !== 'closed')?.id ?? null;
  return { phases, current };
}

/**
 * Record a phase as closed. Caller must have run the phase gate green first.
 * @param {string} root
 * @param {string} id
 * @param {Date} [now]
 */
export function markClosed(root, id, now = new Date()) {
  const i = phaseIndex(id);
  const state = readState(root);
  const hashes = Object.fromEntries(
    PHASES.slice(0, i + 1).map((p) => [p.artifact, hashFile(join(root, p.artifact))]),
  );
  state.phases[id] = { closedAt: now.toISOString(), hashes };
  writeState(root, state);
}
