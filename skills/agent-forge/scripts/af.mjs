#!/usr/bin/env node
// af — the agent-forge toolkit CLI. Every deterministic step of the process lives here.
// Usage: node <skill-dir>/scripts/af.mjs <command> [args]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKLIST, closePhase, runGate } from './lib/gates.mjs';
import { checkDestructive, checkPaid, checkPhaseWrite, checkSecretCommand, checkSecretWrite } from './lib/guards.mjs';
import { validateSpecFile } from './lib/spec.mjs';
import { emptyState, findProjectRoot, markClosed, PHASES, status, STATE_DIR, writeState } from './lib/state.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `af — agent-forge toolkit

  af init [dir]                 create .agent-forge/ with AGENT_SPEC.md template and state.json
  af status [--json]            phases, their state, and the next phase to work on
  af validate-spec [path]       check AGENT_SPEC.md (grill gate)
  af gate <phase>               run a phase gate without closing it
  af close <phase>              run the gate and, if green, record the phase as closed
  af check-write <file>         phase-gate + secret-guard for a file you are about to write (content on stdin)
  af check-command <command>    destructive-, secret- and paid-call-guard for a shell command

Phases: ${PHASES.map((p) => p.id).join(' → ')}
Exit codes: 0 ok · 1 check failed · 2 usage error`;

const out = (s) => process.stdout.write(`${s}\n`);
const fail = (lines, code = 1) => {
  for (const l of [lines].flat()) process.stderr.write(`${l}\n`);
  process.exit(code);
};

function root() {
  const r = findProjectRoot(process.cwd());
  if (!r) fail(`ERROR: no ${STATE_DIR}/state.json found from ${process.cwd()} upwards. Run: af init`, 1);
  return r;
}

function init(dir = '.') {
  const target = resolve(dir);
  const spec = join(target, STATE_DIR, 'AGENT_SPEC.md');
  mkdirSync(join(target, STATE_DIR), { recursive: true });
  if (existsSync(join(target, STATE_DIR, 'state.json'))) {
    out(`${STATE_DIR}/ already exists in ${target}; left untouched. Run: af status`);
    return;
  }
  if (!existsSync(spec)) copyFileSync(join(SKILL_DIR, 'templates', 'AGENT_SPEC.md'), spec);
  for (const f of ['decisions.md', 'handoff.md']) {
    const p = join(target, STATE_DIR, f);
    if (!existsSync(p)) writeFileSync(p, f === 'decisions.md' ? '# Decisions\n\n| date | decision | why | by |\n|---|---|---|---|\n' : '# Handoff\n\nNext: /agent-forge-grill\n');
  }
  writeState(target, emptyState());
  out(`Initialized ${STATE_DIR}/ in ${target}. Next: /agent-forge-grill`);
}

function printStatus(json) {
  const st = status(root());
  if (json) return out(JSON.stringify(st, null, 2));
  for (const p of st.phases) out(`${p.status === 'closed' ? '✔' : p.status === 'stale' ? '↻' : '·'} ${p.id.padEnd(10)} ${p.status}${p.changed.length ? `  (changed: ${p.changed.join(', ')})` : ''}`);
  out(st.current ? `Next: /agent-forge-${st.current}` : 'All phases closed.');
}

function report(result, okLine) {
  if (!result.ok) fail(result.errors);
  out(okLine);
}

const verdictExit = (v) => {
  if (v.decision === 'allow') return out('OK');
  fail(`${v.decision === 'ask' ? 'CONFIRM' : 'BLOCKED'}: ${v.reason}`);
};

async function stdin() {
  if (process.stdin.isTTY) return '';
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
}

async function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'init':
      return init(args[0]);
    case 'status':
      return printStatus(args.includes('--json'));
    case 'validate-spec': {
      const path = args[0] ?? join(root(), STATE_DIR, 'AGENT_SPEC.md');
      if (!existsSync(path)) fail(`ERROR: ${path} not found. Run: af init`);
      const errors = validateSpecFile(path, CHECKLIST);
      return report({ ok: errors.length === 0, errors }, 'OK: AGENT_SPEC.md passes the grill gate.');
    }
    case 'gate':
      if (!args[0]) fail('ERROR: missing phase. Usage: af gate <phase>', 2);
      return report(runGate(root(), args[0]), `OK: gate "${args[0]}" is green.`);
    case 'close': {
      if (!args[0]) fail('ERROR: missing phase. Usage: af close <phase>', 2);
      const r = root();
      const res = closePhase(r, args[0]);
      if (!res.ok) fail(res.errors);
      markClosed(r, args[0]);
      const next = status(r).current;
      return out(`Closed "${args[0]}". ${next ? `Next: /agent-forge-${next}` : 'All phases closed.'}`);
    }
    case 'check-write': {
      if (!args[0]) fail('ERROR: missing file. Usage: af check-write <file> < content', 2);
      const file = resolve(args[0]);
      const phase = checkPhaseWrite(file);
      if (phase.decision !== 'allow') return verdictExit(phase);
      return verdictExit(checkSecretWrite(file, await stdin()));
    }
    case 'check-command': {
      const command = args.join(' ');
      if (!command) fail('ERROR: missing command. Usage: af check-command "<shell command>"', 2);
      for (const check of [checkDestructive, checkSecretCommand, checkPaid]) {
        const v = check(command);
        if (v.decision !== 'allow') return verdictExit(v);
      }
      return out('OK');
    }
    case undefined:
    case 'help':
    case '--help':
      return out(USAGE);
    default:
      fail([`ERROR: unknown command "${cmd}".`, USAGE], 2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));

export { main };
