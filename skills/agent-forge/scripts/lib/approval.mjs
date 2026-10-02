// Human ownership of phase transitions.
//
// grill and architect close only on the user's approval, typed in an interactive terminal that is
// not a child of an AI-agent process. Every close record is signed with a per-user key kept outside
// the project, so a hand-edited state.json is reported as unverified and unlocks nothing.
//
// Limit, stated plainly: an agent running as the same OS user can still read the key or fake a
// terminal if it deliberately sets out to. This turns "the user told me to skip it" into overt
// circumvention, and makes forged state visible. A hard boundary needs OS-level isolation (a
// sandbox that cannot read AF_HOME).
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Phases whose completion is a user decision, not a machine-checkable gate. */
export const HUMAN_PHASES = new Set(['grill', 'architect']);

/** Directory holding the signing key; outside every project on purpose. */
export const afHome = () => process.env.AF_HOME ?? join(homedir(), '.agent-forge');
const keyPath = () => join(afHome(), 'signing.key');

/** Existing key, or a new 0600 key when `create` is set; null when absent and not created. */
function key(create) {
  const path = keyPath();
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
  if (!create) return null;
  mkdirSync(afHome(), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
}

const payload = (phase, rec) =>
  JSON.stringify({
    phase,
    closedAt: rec.closedAt,
    approvedBy: rec.approvedBy,
    hashes: Object.fromEntries(Object.entries(rec.hashes ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  });

/** Signature for a close record. Creates the key on first use. */
export function sign(phase, rec) {
  return createHmac('sha256', key(true)).update(payload(phase, rec)).digest('hex');
}

/** True only for a record signed with this user's key. */
export function verify(phase, rec) {
  const k = key(false);
  if (!k || typeof rec?.sig !== 'string' || !/^[0-9a-f]{64}$/.test(rec.sig)) return false;
  const expected = createHmac('sha256', k).update(payload(phase, rec)).digest();
  return timingSafeEqual(expected, Buffer.from(rec.sig, 'hex'));
}

// ---------------------------------------------------------------- who is asking

const AGENT_PROCESS = /(?:^|[\s/\\])(?:codex|claude|claude-code|hermes|cursor-agent|aider|opencode|gemini|goose)(?:\.exe|\.js|\.mjs)?(?:\s|$)|@anthropic-ai[/\\]claude-code|@openai[/\\]codex/i;
const AGENT_ENV = ['CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_THREAD_ID', 'HERMES_SESSION_ID', 'HERMES_KANBAN_TASK'];

/** Command line of the nearest ancestor that looks like an AI-agent runtime, or null. */
export function agentAncestor(pid = process.ppid, run = spawnSync) {
  if (process.platform === 'win32') return null;
  for (let depth = 0; pid > 1 && depth < 64; depth++) {
    const res = run('ps', ['-o', 'ppid=,args=', '-p', String(pid)], { encoding: 'utf8' });
    const line = (res.stdout ?? '').trim();
    if (!line) return null;
    const [, ppid, args] = line.match(/^(\d+)\s+(.*)$/) ?? [];
    if (args && AGENT_PROCESS.test(args)) return args.slice(0, 120);
    pid = Number(ppid);
  }
  return null;
}

/** Synchronous line read from the controlling terminal (stdin may be non-blocking: EAGAIN). */
function readLine() {
  const fd = process.platform === 'win32' ? 0 : openSync('/dev/tty', 'r');
  const buf = Buffer.alloc(1);
  let line = '';
  try {
    for (;;) {
      let n;
      try {
        n = readSync(fd, buf, 0, 1, null);
      } catch (error) {
        if (error.code === 'EAGAIN') {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
          continue;
        }
        throw error;
      }
      if (n !== 1 || buf[0] === 10) break;
      line += String.fromCharCode(buf[0]);
    }
  } finally {
    if (fd !== 0) closeSync(fd);
  }
  return line.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

/** Thrown when a close needs the user and the user is not the one at the keyboard. */
export class ApprovalRequired extends Error {}

/**
 * Ask the user to approve closing `phase`. Returns the approval label stored in the record.
 * @param {string} phase
 * @param {{ summary?: string, command?: string, ancestor?: () => string | null }} [info]
 * @returns {string}
 */
export function humanApproval(phase, info = {}) {
  const how = `Ask the user to run this in their own terminal (not inside an agent session):\n  ${info.command ?? `af close ${phase}`}`;
  const envHit = AGENT_ENV.find((v) => process.env[v]);
  const ancestor = envHit ? `environment variable ${envHit}` : (info.ancestor ?? agentAncestor)();
  if (ancestor) {
    throw new ApprovalRequired(
      `Closing "${phase}" is the user's decision and cannot be approved from an AI-agent session (detected: ${ancestor}). Do not work around this. ${how}`,
    );
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ApprovalRequired(`Closing "${phase}" needs the user's approval in an interactive terminal. ${how}`);
  }
  process.stdout.write(
    `\n${info.summary ?? ''}\nThis approval is for the human user. An AI agent must not answer it.\nType "${phase}" to approve closing the ${phase} phase, anything else to cancel: `,
  );
  if (readLine() !== phase) throw new ApprovalRequired(`Closing "${phase}" was not approved.`);
  return 'terminal';
}

// ---------------------------------------------------------------- shell-command policy

const CLOSE_HUMAN = /\baf(?:\.mjs)?["']?\s+close\s+["']?(grill|architect)\b/;
const STATE_WRITE = /\.agent-forge\/state\.json/;
const WRITE_VERB = /(?:>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|writeFile|\bopen\(|apply_patch|\btruncate\b)/;

/**
 * Commands an agent must not run: closing a human phase, writing state.json, touching the key.
 * @param {string} command
 * @returns {{ decision: 'allow' | 'deny', reason?: string }}
 */
export function checkPhaseCommand(command) {
  const close = command.match(CLOSE_HUMAN);
  if (close) {
    return {
      decision: 'deny',
      reason: `phase-gate: only the user closes "${close[1]}", after confirming it, in their own terminal. Show them the exact command and stop; do not run it for them.`,
    };
  }
  if (STATE_WRITE.test(command) && WRITE_VERB.test(command)) {
    return { decision: 'deny', reason: 'phase-gate: .agent-forge/state.json is written only by `af`. Hand edits are detected and reported as unverified.' };
  }
  if (/signing\.key|\bAF_HOME\b|\.agent-forge\/signing/.test(command)) {
    return { decision: 'deny', reason: 'phase-gate: the agent-forge signing key is off-limits to agents.' };
  }
  return { decision: 'allow' };
}

// Scaffolding is the first act of the build phase; copying the template in bulk would bypass the
// per-file write gate, so it is held to the same rule.
const SCAFFOLD = /\b(?:cp|rsync|ditto|tar|cpio)\b[^|;&]*templates\/app\b/;

/**
 * Shell-level phase gate: {@link checkPhaseCommand} plus template scaffolding, which is allowed
 * only once grill and architect are closed in the project at `cwd`.
 * @param {string} command
 * @param {(cwd: string) => { phases: Array<{ id: string, status: string }> } | null} projectStatus
 * @param {string} [cwd]
 */
export function checkPhaseShell(command, projectStatus, cwd = process.cwd()) {
  const base = checkPhaseCommand(command);
  if (base.decision !== 'allow' || !SCAFFOLD.test(command)) return base;
  const st = projectStatus(cwd);
  const open = st?.phases.filter((p) => HUMAN_PHASES.has(p.id) && p.status !== 'closed') ?? [];
  if (st && open.length === 0) return base;
  return {
    decision: 'deny',
    reason: `phase-gate: copying the app template is the build phase, which is locked until the user has closed grill and architect${open.length ? ` ("${open[0].id}" is ${open[0].status})` : ' (run `af init` and the interview first)'}. Continue the interview instead.`,
  };
}
