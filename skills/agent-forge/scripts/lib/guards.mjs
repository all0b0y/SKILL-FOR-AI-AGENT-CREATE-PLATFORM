// Pure policy checks behind the five hooks. Each returns a verdict object; adapters turn it
// into Claude Code hook JSON (hooks/hook.mjs) or an exit code (af check-*), so Claude Code
// and hook-less runtimes such as Hermes enforce the same rules.
import { existsSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { findProjectRoot, status, STATE_DIR } from './state.mjs';

/** @typedef {{ decision: 'allow' | 'deny' | 'ask', reason?: string }} Verdict */
const allow = () => ({ decision: 'allow' });
const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

// ---------------------------------------------------------------- secret-guard

/** Known credential shapes. Names appear in the denial so the agent knows what matched. */
export const SECRET_PATTERNS = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['connection string with password', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]{6,}@(?!localhost|127\.0\.0\.1|db\b|postgres\b)/],
];

/** Local env files hold secrets by design; templates (`.env.example`) never do. */
const isLocalEnvFile = (path) => /^\.env(\..+)?$/.test(basename(path)) && !/\.example$|\.sample$|\.template$/.test(path);

/**
 * @param {string} text content about to be written or a shell command
 * @returns {string | null} name of the matched secret kind
 */
export function findSecret(text) {
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) return name;
  return null;
}

/** @returns {Verdict} */
export function checkSecretWrite(filePath, content) {
  if (isLocalEnvFile(filePath)) return allow();
  const kind = findSecret(content ?? '');
  return kind
    ? deny(`secret-guard: ${kind} found in ${basename(filePath)}. Put the value in .env.local (gitignored) and read it via process.env; commit only the variable name in .env.example.`)
    : allow();
}

/** @returns {Verdict} */
export function checkSecretCommand(command) {
  const kind = findSecret(command);
  if (kind) return deny(`secret-guard: ${kind} in a shell command (it lands in history and logs). Export it from .env.local or pass it through an env file instead.`);
  if (/\bgit\s+add\b[^;&|]*(?:\s-f\b|\s--force\b)[^;&|]*\.env/.test(command) || /\bgit\s+add\b[^;&|]*\s\.env(?:\.local)?\b(?!\.example)/.test(command)) {
    return deny('secret-guard: .env files stay out of git. Commit .env.example with variable names only.');
  }
  return allow();
}

// ---------------------------------------------------------------- destructive-guard

const SAFE_RM_TARGET = /^(?:\.\/)?(?:node_modules|\.next|dist|build|out|coverage|\.turbo|\.cache|playwright-report|test-results|\.agent-forge\/tmp)(?:\/.*)?$|^\/tmp\/./;

/** Targets of an `rm` invocation that has both recursive and force flags, else null. */
function rmRecursiveForceTargets(segment) {
  const tokens = segment.trim().split(/\s+/);
  const i = tokens.findIndex((t) => t === 'rm' || t.endsWith('/rm'));
  if (i === -1) return null;
  const args = tokens.slice(i + 1);
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const recursive = /-[a-zA-Z]*[rR]|--recursive/.test(flags);
  const force = /-[a-zA-Z]*f|--force/.test(flags);
  if (!(recursive && force)) return null;
  return args.filter((a) => !a.startsWith('-'));
}

const DESTRUCTIVE = [
  [/\bgit\s+push\b(?=[^;&|]*\s(?:--force(?!-with-lease)\b|-f\b))/, 'git push --force rewrites shared history. Use `git push --force-with-lease` on your own branch, or `git revert`.'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard discards uncommitted work. Use `git stash` or `git restore <path>` for specific files.'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'git clean -f deletes untracked files. Run `git clean -n` to preview and delete specific paths.'],
  [/\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?\w)/i, 'DROP/TRUNCATE destroys data. Write a reversible migration (drizzle-kit generate) with a down-step instead.'],
  [/\bdrizzle-kit\s+(?:drop|push\b[^;&|]*--force)/, 'drizzle-kit drop/push --force can lose data. Use `drizzle-kit generate` + `migrate`.'],
  [/\bdocker\s+(?:compose\s+down\b[^;&|]*\s-v\b|volume\s+(?:rm|prune)\b|system\s+prune\b)/, 'This deletes Docker volumes (the Postgres data). Use `docker compose down` without -v.'],
];

/** @returns {Verdict} */
export function checkDestructive(command) {
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const targets = rmRecursiveForceTargets(segment);
    if (targets && (targets.length === 0 || targets.some((t) => !SAFE_RM_TARGET.test(t)))) {
      return deny(`destructive-guard: \`rm -rf ${targets.join(' ')}\` blocked. Delete specific files, or limit recursive deletes to build output (node_modules, .next, dist, coverage).`);
    }
  }
  for (const [re, alternative] of DESTRUCTIVE) if (re.test(command)) return deny(`destructive-guard: ${alternative}`);
  return allow();
}

// ---------------------------------------------------------------- paid-call-guard

const PAID = [
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?[\w:-]*(?:eval|bench)[\w-]*:live\b/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?[\w:-]*evals?[\w-]*:record\b/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?evals?\b.*--mode[=\s]+(?:live|record)\b/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?retrieval:accept\b/,
  /\bmodel-bench\b/,
  /\bclaude\s+plugin\s+eval\b(?!\s+init\s+--bare)/,
  /\bclaude\s+(?:-p|--print)\b/,
  /\bapi\.(?:anthropic|openai)\.com\b|\bgenerativelanguage\.googleapis\.com\b/,
];

/** @returns {Verdict} */
export function checkPaid(command) {
  return PAID.some((re) => re.test(command))
    ? ask('paid-call-guard: this command calls a paid model API. Confirm only if the user asked for a live run now; offline alternative: the record/replay eval suite (`pnpm af:evals-gate`).')
    : allow();
}

// ---------------------------------------------------------------- phase-gate

const SCRIPT_OWNED = [`${STATE_DIR}/state.json`, `${STATE_DIR}/reports/`];
const PLANNING = [`${STATE_DIR}/`];

/**
 * Writes outside `.agent-forge/` are application code: they need grill and architect closed.
 * Script-owned files are never edited by hand.
 * @param {string} filePath absolute path from the tool call
 * @returns {Verdict}
 */
export function checkPhaseWrite(filePath) {
  const root = findProjectRoot(filePath.split(sep).slice(0, -1).join(sep) || sep);
  if (!root) return allow();
  const rel = relative(root, filePath).split(sep).join('/');
  if (rel.startsWith('..')) return allow();
  if (SCRIPT_OWNED.some((p) => rel === p || rel.startsWith(p))) {
    return deny(`phase-gate: ${rel} is written only by af scripts. Run \`af close <phase>\` or \`af gate <phase>\` instead of editing it.`);
  }
  if (PLANNING.some((p) => rel.startsWith(p))) return allow();
  const st = status(root);
  const open = st.phases.filter((p) => ['grill', 'architect'].includes(p.id) && p.status !== 'closed');
  if (open.length === 0) return allow();
  const first = open[0];
  return deny(`phase-gate: application code is locked until phases grill and architect are closed; "${first.id}" is ${first.status}. Continue with /agent-forge-${first.id}, then \`af close ${first.id}\`.`);
}

// ---------------------------------------------------------------- typecheck-lint

/** Which file edits trigger typecheck + lint, and from which project root. */
export function typecheckTarget(filePath) {
  if (!/\.(?:ts|tsx|mts|cts)$/.test(filePath)) return null;
  const root = findProjectRoot(filePath.split(sep).slice(0, -1).join(sep) || sep);
  if (!root || !existsSync(join(root, 'package.json')) || !existsSync(join(root, 'tsconfig.json'))) return null;
  return root;
}
