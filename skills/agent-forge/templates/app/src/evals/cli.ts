/**
 * pnpm evals [--mode replay|record|live] [--split dev|holdout|all] [--case <id>] [--repeat n]
 * pnpm evals:seed | evals:lint | evals:split | model-bench --models a,b
 * Exit 0 = green. `replay` is offline and free; `record`/`live` call the real model.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { db, pool } from '@/db/client';
import { env } from '@/env';
import { CASES_DIR, type Case, isHoldout, loadCases } from './cases';
import { Cassette, type Mode } from './cassette';
import { repeatCount, requirePaidConsent } from './options';
import { type CaseResult, runCase } from './runner';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const command = args[0]?.startsWith('--') ? 'run' : (args[0] ?? 'run');
const SPLIT_FILE = join(process.cwd(), 'evals', 'split.json');
const CASSETTE = (modelId: string) =>
  join(process.cwd(), 'evals', 'cassettes', `${modelId.replace(/[^\w.-]/g, '_')}.json`);

function fail(lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(1);
}

function cases(): Case[] {
  const { cases, errors } = loadCases();
  if (errors.length) fail(errors);
  return cases;
}

function selected(all: Case[], split = flag('split') ?? 'dev'): Case[] {
  const only = flag('case');
  if (only) return all.filter((c) => c.id === only);
  if (split === 'all') return all;
  if (!existsSync(SPLIT_FILE)) fail(['ERROR: evals/split.json missing. Run: pnpm evals:split']);
  const ids = new Set(
    (JSON.parse(readFileSync(SPLIT_FILE, 'utf8')) as Record<string, string[]>)[split] ?? [],
  );
  return all.filter((c) => ids.has(c.id));
}

async function run(modelId: string, mode: Mode, list: Case[]): Promise<CaseResult[]> {
  requirePaidConsent(mode, modelId);
  const cassette = new Cassette(CASSETTE(modelId));
  const judgeModelId = process.env.AF_JUDGE_MODEL ?? modelId;
  requirePaidConsent(mode, judgeModelId);
  const repeat = repeatCount(flag('repeat'));
  const results: CaseResult[] = [];
  for (const c of list) {
    const r = await runCase(db, repeat ? { ...c, repeat: Number(repeat) } : c, {
      modelId,
      cassette,
      mode,
      judgeModelId,
    });
    results.push(r);
    const mark = r.pass ? '✓' : '✗';
    const why = r.runs.flatMap((x) => [
      ...(x.error ? [x.error] : []),
      ...x.graders.filter((g) => !g.pass).map((g) => `${g.grader}: ${g.detail}`),
    ]);
    console.log(
      `${mark} ${c.id.padEnd(28)} ${c.kind.padEnd(11)} ${r.runs.filter((x) => x.pass).length}/${r.runs.length}${why.length ? `  ${why[0]}` : ''}`,
    );
  }
  if (mode === 'record') cassette.save();
  return results;
}

async function main() {
  switch (command) {
    case 'lint': {
      const all = cases();
      const empty = all.length === 0 ? ['ERROR: no cases in evals/cases. Run: pnpm evals:seed'] : [];
      if (empty.length) fail(empty);
      console.log(`OK: ${all.length} cases valid.`);
      return;
    }
    case 'split': {
      const all = cases();
      const split = {
        dev: all.filter((c) => !isHoldout(c.id)).map((c) => c.id),
        holdout: all.filter((c) => isHoldout(c.id)).map((c) => c.id),
      };
      writeFileSync(SPLIT_FILE, `${JSON.stringify(split, null, 2)}\n`);
      // Generated, checked-in JSON must satisfy the same formatter as hand-written code.
      execFileSync('pnpm', ['exec', 'biome', 'format', '--write', SPLIT_FILE], { stdio: 'inherit' });
      console.log(`dev ${split.dev.length} · holdout ${split.holdout.length} → evals/split.json`);
      return;
    }
    case 'seed': {
      const spec = readFileSync(join(process.cwd(), '.agent-forge', 'AGENT_SPEC.md'), 'utf8');
      const section = spec.split(/^## /m).find((s) => s.startsWith('evals')) ?? '';
      const rows = section
        .split('\n')
        .filter((l) => /^\|/.test(l))
        .slice(2)
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((x) => x.trim()),
        );
      mkdirSync(CASES_DIR, { recursive: true });
      let n = 0;
      for (const [id, input, expected] of rows) {
        if (!id || !input) continue;
        const file = join(CASES_DIR, `${id}.yaml`);
        if (existsSync(file)) continue;
        writeFileSync(
          file,
          `# expected: ${expected}\n# Add graders that check the expected behaviour, cheapest first.\n${stringify({ id, origin: 'interview', kind: 'typical', input, graders: [] })}`,
        );
        n++;
      }
      console.log(
        `seeded ${n} cases from AGENT_SPEC.md (graders are empty: evals:lint stays red until you add them)`,
      );
      return;
    }
    case 'bench': {
      const models = (flag('models') ?? '').split(',');
      if (
        models.length < 2 ||
        models.some((model) => !model.trim()) ||
        new Set(models).size !== models.length
      )
        fail(['ERROR: pass at least two distinct models: pnpm model-bench --models anthropic/a,anthropic/b']);
      const list = selected(cases(), 'all');
      if (list.length === 0) fail(['ERROR: no cases selected. Check --case before benchmarking.']);
      const table: Array<{ model: string; passed: number; total: number; cost: number }> = [];
      for (const m of models) {
        console.log(`\n== ${m}`);
        const results = await run(m, 'live', list);
        const cost = results.reduce((s, r) => s + r.runs.reduce((x, y) => x + y.costUsd, 0), 0);
        table.push({ model: m, passed: results.filter((r) => r.pass).length, total: results.length, cost });
      }
      console.table(table);
      const winner = table.filter((t) => t.passed === t.total).sort((a, b) => a.cost - b.cost)[0];
      console.log(
        winner
          ? `Cheapest model passing every case: ${winner.model}. Record it in decisions.md.`
          : 'No model passed every case.',
      );
      return;
    }
    case 'run': {
      const mode = (flag('mode') ?? 'replay') as Mode;
      if (!['replay', 'record', 'live'].includes(mode))
        fail([`ERROR: unknown mode "${mode}". Use replay, record or live.`]);
      const list = selected(cases());
      if (list.length === 0)
        fail(['ERROR: no cases selected. Check --split/--case or run pnpm evals:split.']);
      const results = await run(env().AF_MODEL, mode, list);
      const failed = results.filter((r) => !r.pass);
      const adversarialFailed = failed.filter((r) => r.kind === 'adversarial');
      mkdirSync(join(process.cwd(), 'evals', 'results'), { recursive: true });
      writeFileSync(
        join(process.cwd(), 'evals', 'results', 'latest.json'),
        `${JSON.stringify({ mode, at: new Date().toISOString(), results }, null, 2)}\n`,
      );
      console.log(
        `\n${results.length - failed.length}/${results.length} passed${adversarialFailed.length ? ` · ${adversarialFailed.length} adversarial FAILED` : ''}`,
      );
      if (failed.length) process.exitCode = 1;
      return;
    }
    default:
      fail([`ERROR: unknown command "${command}". Use run, seed, lint, split or bench.`]);
  }
}

try {
  await main();
} finally {
  await pool.end();
}
