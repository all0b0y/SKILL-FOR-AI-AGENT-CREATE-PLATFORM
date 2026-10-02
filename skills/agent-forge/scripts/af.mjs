#!/usr/bin/env node
// af — the agent-forge toolkit CLI. Every deterministic step of the process lives here.
// Usage: node <skill-dir>/scripts/af.mjs <command> [args]
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAnswer, decisionRow, specSummary } from './lib/answer.mjs';
import { ApprovalRequired, checkPhaseShell } from './lib/approval.mjs';
import { CHECKLIST, closePhase, runGate } from './lib/gates.mjs';
import { checkDestructive, checkPaid, checkPhaseWrite, checkSecretCommand, checkSecretWrite } from './lib/guards.mjs';
import { validateSpecFile } from './lib/spec.mjs';
import { emptyState, findProjectRoot, markClosed, PHASES, status, STATE_DIR, writeState } from './lib/state.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `af — agent-forge toolkit

  af init [dir]                 create .agent-forge/ with AGENT_SPEC.md template and state.json
  af status [--json]            phases, their state, and the next phase to work on
  af answer <target> <value> [--q Q7] [--why text] [--by user|default] [--append]
                                record one interview answer in AGENT_SPEC.md and decisions.md;
                                target: language | case | <section>.<Field> | <table-section> (value "a | b | c")
  af spec [section]             one-line-per-section summary, or one section in full
  af validate-spec [path]       check AGENT_SPEC.md (grill gate)
  af gate <phase>               run a phase gate without closing it
  af close <phase>              run the gate and, if green, record the phase as closed
  af check-write <file>         phase-gate + secret-guard for a file you are about to write (content on stdin)
  af check-command <command>    destructive-, secret- and paid-call-guard for a shell command

Phases: ${PHASES.map((p) => p.id).join(' → ')}
Exit codes: 0 ok · 1 check failed · 2 usage error`;

const out = (s) => process.stdout.write(`${s}\n`);

// What the agent's reply to the user must be at each phase; printed wherever `Next:` is.
const REPLY = {
  grill: 'Your reply to the user is exactly one interview question: the next unanswered one, numbered, with your recommended option first. That holds even if they asked to skip or to get all questions at once. No status report, no question list, no offer to fill the rest with defaults.',
  architect: 'Draft ARCHITECTURE.md, run `af gate architect`, then ask the user to approve the rung and tool table.',
};
const next = (phase) => (phase ? `Next: /agent-forge-${phase}${REPLY[phase] ? `\n${REPLY[phase]}` : ''}` : 'All phases closed.');
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
  out(`Initialized ${STATE_DIR}/ in ${target}. ${next('grill')}`);
}

function printStatus(json) {
  const st = status(root());
  if (json) return out(JSON.stringify(st, null, 2));
  const mark = { closed: '✔', stale: '↻', unverified: '✗' };
  for (const p of st.phases) out(`${mark[p.status] ?? '·'} ${p.id.padEnd(10)} ${p.status}${p.changed.length ? `  (changed: ${p.changed.join(', ')})` : ''}${p.status === 'unverified' ? '  (record not written by af close; re-run the phase)' : ''}`);
  out(next(st.current));
}

/** `af answer`: write one answer, log it, and report what the grill gate still needs. */
function answer(args) {
  const opts = { append: false, by: 'user', q: undefined, why: undefined };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--append') opts.append = true;
    else if (['--q', '--why', '--by'].includes(a)) opts[a.slice(2)] = args[++i];
    else rest.push(a);
  }
  const [target, ...words] = rest;
  const value = words.join(' ');
  if (!target || !value.trim()) fail('ERROR: usage: af answer <target> <value> [--q Q7] [--why text] [--by user|default] [--append]', 2);
  if (!['user', 'default'].includes(opts.by)) fail('ERROR: --by must be user or default.', 2);
  const dir = join(root(), STATE_DIR);
  const specPath = join(dir, 'AGENT_SPEC.md');
  let updated;
  try {
    updated = applyAnswer(readFileSync(specPath, 'utf8'), target, value, opts);
  } catch (error) {
    fail(`ERROR: ${error.message}`);
  }
  writeFileSync(specPath, updated);
  const date = new Date().toISOString().slice(0, 10);
  appendFileSync(join(dir, 'decisions.md'), `${decisionRow({ date, target, value, ...opts })}\n`);
  const errors = validateSpecFile(specPath, CHECKLIST);
  out(`Recorded ${target}${opts.q ? ` (${opts.q})` : ''}, by ${opts.by}. Grill gate: ${errors.length ? `${errors.length} open; next: ${errors[0].replace(/^ERROR:\s*/, '')}` : 'green — show the summary (`af spec`) and ask the user to confirm.'}`);
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
    case 'answer':
      return answer(args);
    case 'spec': {
      const text = readFileSync(join(root(), STATE_DIR, 'AGENT_SPEC.md'), 'utf8');
      if (!args[0]) return out(specSummary(text));
      const m = text.split(/^(?=## )/m).find((part) => part.match(/^##\s+(\S+)/)?.[1].toLowerCase() === args[0].toLowerCase());
      if (!m) fail(`ERROR: section "${args[0]}" not found.`);
      return out(m.trimEnd());
    }
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
      try {
        markClosed(r, args[0], new Date(), { summary: `Gate "${args[0]}" is green in ${r}.` });
      } catch (error) {
        if (error instanceof ApprovalRequired) fail(`BLOCKED: ${error.message}`);
        throw error;
      }
      return out(`Closed "${args[0]}". ${next(status(r).current)}`);
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
      const phaseShell = (c) =>
        checkPhaseShell(c, (cwd) => {
          const r = findProjectRoot(cwd);
          return r ? status(r) : null;
        });
      for (const check of [phaseShell, checkDestructive, checkSecretCommand, checkPaid]) {
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

// Compare real paths: an installed skill is often reached through a symlink, and a mismatch
// here would skip main() and exit 0, making every guard look like a pass.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) await main(process.argv.slice(2));

export { main };
