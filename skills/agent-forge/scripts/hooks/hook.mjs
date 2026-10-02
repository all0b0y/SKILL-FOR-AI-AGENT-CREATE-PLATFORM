#!/usr/bin/env node
// Claude Code hook adapter: reads the hook JSON on stdin, applies one policy from
// lib/guards.mjs, prints hook JSON. Fast exit on the common no-op path keeps us well
// inside the hook timeout (a timed-out PreToolUse hook fails open).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  checkDestructive, checkPaid, checkPhaseWrite, checkSecretCommand, checkSecretWrite, typecheckTarget,
} from '../lib/guards.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MAX_REASON = 4000;

/** Text a write-like tool is about to put on disk. */
function writtenText(input) {
  if (typeof input.content === 'string') return input.content;
  if (typeof input.new_string === 'string') return input.new_string;
  if (Array.isArray(input.edits)) return input.edits.map((e) => e.new_string ?? '').join('\n');
  if (typeof input.new_source === 'string') return input.new_source;
  return '';
}

/**
 * Decide for one hook name and one event payload.
 * @param {string} name
 * @param {any} event
 * @param {{ run?: typeof spawnSync }} [deps]
 * @returns {object | null} hook JSON, or null for "no opinion"
 */
export function decide(name, event, deps = {}) {
  const tool = event.tool_name;
  const input = event.tool_input ?? {};
  const filePath = input.file_path ?? input.notebook_path ?? '';
  let verdict = { decision: 'allow' };

  if (name === 'secret-guard') {
    if (WRITE_TOOLS.has(tool)) verdict = checkSecretWrite(filePath, writtenText(input));
    else if (tool === 'Bash') verdict = checkSecretCommand(input.command ?? '');
  } else if (name === 'destructive-guard' && tool === 'Bash') {
    verdict = checkDestructive(input.command ?? '');
  } else if (name === 'paid-call-guard' && tool === 'Bash') {
    verdict = checkPaid(input.command ?? '');
  } else if (name === 'phase-gate' && WRITE_TOOLS.has(tool) && filePath) {
    verdict = checkPhaseWrite(filePath);
  } else if (name === 'typecheck-lint' && WRITE_TOOLS.has(tool) && filePath) {
    return typecheck(filePath, deps.run ?? spawnSync);
  }

  if (verdict.decision === 'allow') return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.decision,
      permissionDecisionReason: verdict.reason,
    },
  };
}

/** PostToolUse: run tsc + biome on the project and hand failures back to the agent. */
function typecheck(filePath, run) {
  const root = typecheckTarget(filePath);
  if (!root) return null;
  const opts = { cwd: root, encoding: 'utf8', stdio: 'pipe' };
  const tsc = run('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false'], opts);
  const lint = run('pnpm', ['exec', 'biome', 'check', filePath], opts);
  const failures = [
    tsc.status !== 0 ? `tsc --noEmit:\n${tsc.stdout}${tsc.stderr}` : '',
    lint.status !== 0 ? `biome check ${filePath}:\n${lint.stdout}${lint.stderr}` : '',
  ].filter(Boolean);
  if (failures.length === 0) return null;
  return {
    decision: 'block',
    reason: `typecheck-lint failed after editing ${filePath}. Fix these before continuing:\n${failures.join('\n').slice(0, MAX_REASON)}`,
  };
}

async function main() {
  const name = process.argv[2];
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    process.stderr.write('ERROR: hook received non-JSON stdin. It must be run by Claude Code as a hook.\n');
    process.exit(1);
  }
  const out = decide(name, event);
  if (out) process.stdout.write(JSON.stringify(out));
}

// Compare real paths: an installed skill is often reached through a symlink, and a mismatch
// here would skip main() and exit 0, making every guard look like a pass.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
