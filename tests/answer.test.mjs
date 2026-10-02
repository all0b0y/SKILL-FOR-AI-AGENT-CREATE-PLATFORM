import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyAnswer, decisionRow, specSummary } from '../skills/agent-forge/scripts/lib/answer.mjs';
import { gapIds, validateSpec } from '../skills/agent-forge/scripts/lib/spec.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AF = join(ROOT, 'skills/agent-forge/scripts/af.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'skills/agent-forge/templates/AGENT_SPEC.md'), 'utf8');
const GAPS = gapIds(readFileSync(join(ROOT, 'skills/agent-forge/references/gap-sweep.md'), 'utf8'));

/** The support reference interview, answer by answer. */
const INTERVIEW = [
  ['language', 'ru'],
  ['case', 'Агент поддержки интернет-магазина отвечает клиентам в чате по базе знаний и создаёт тикет после подтверждения оператора.'],
  ['resources', 'Anthropic API key | have | production account'],
  ['resources', 'Knowledge base | have | 120 markdown articles'],
  ['goal.Metric', 'доля вопросов, решённых без тикета'],
  ['goal.Target', '70%'],
  ['users.Users', 'клиенты магазина'],
  ['users.Surfaces', 'chat'],
  ['tools', 'kb_search | native | read | ответ по статьям'],
  ['tools', 'ticket_create | native | write | эскалация'],
  ['rejected-tools', 'order_refund | возвраты делает только оператор'],
  ['autonomy.Max-steps', '8'],
  ['autonomy.Failure-threshold', '2'],
  ['memory', 'working | yes | диалог'],
  ['memory', 'knowledge | yes | статьи'],
  ['memory', 'facts | no | не нужно'],
  ['risks.Untrusted-sources', 'сообщения клиента'],
  ['risks.Classifier', 'off'],
  ['budget.Baseline-model', 'anthropic/claude-opus-5'],
  ['budget.Max-cost-usd-per-run', '0.05'],
  ['budget.Target-latency-ms', '1500'],
  ...['delivery', 'return', 'broken', 'unknown', 'injection'].map((id) => ['evals', `${id} | вопрос ${id} | ожидаемое поведение ${id}`]),
  ['deployment.Target', 'docker'],
  ['deployment.Identity', 'trusted-header'],
  ['ui.Screens', 'chat, approvals, runs'],
  ['ui.Tone', 'спокойный'],
  ['ui.Accent', 'default'],
  ...GAPS.map((id) => ['gap-sweep', `${id} | answered | обсуждено`]),
];

test('a whole interview recorded through applyAnswer alone passes the grill gate', () => {
  let spec = TEMPLATE;
  assert.notDeepEqual(validateSpec(spec, GAPS), []);
  for (const [target, value] of INTERVIEW) spec = applyAnswer(spec, target, value);
  assert.deepEqual(validateSpec(spec, GAPS), []);
  assert.doesNotMatch(spec, /\| <(?:API|tool_name|case-1)/, 'template placeholder rows are dropped');
});

test('answers upsert: a changed answer replaces the old one instead of adding a duplicate', () => {
  let spec = applyAnswer(TEMPLATE, 'autonomy.Max-steps', '8');
  spec = applyAnswer(spec, 'autonomy.Max-steps', '20');
  assert.equal(spec.match(/^Max-steps:/gm).length, 1);
  assert.match(spec, /^Max-steps: 20$/m);
  spec = applyAnswer(spec, 'tools', 'kb_search | native | read | ответ');
  spec = applyAnswer(spec, 'tools', 'kb_search | native | read | ответ по статьям');
  assert.equal(spec.match(/^\| kb_search /gm).length, 1);
  assert.match(spec, /ответ по статьям/);
});

test('a default is marked as one; case can grow sentence by sentence', () => {
  let spec = applyAnswer(TEMPLATE, 'autonomy.Max-steps', '8', { by: 'default' });
  assert.match(spec, /^Max-steps: default: 8$/m);
  spec = applyAnswer(spec, 'case', 'Первое предложение.');
  spec = applyAnswer(spec, 'case', 'Второе предложение.', { append: true });
  assert.match(spec, /Первое предложение\. Второе предложение\./);
  assert.doesNotMatch(spec.split('## case')[1].split('## resources')[0], /<!--/);
});

test('bad targets fail with a message that says what to pass', () => {
  assert.throws(() => applyAnswer(TEMPLATE, 'nope.Field', 'x'), /section "nope" not found; sections: case, resources/);
  assert.throws(() => applyAnswer(TEMPLATE, 'tools', 'only | two'), /rows have 4 cells \(name \| source \| risk \| scenario\); got 2/);
  assert.throws(() => applyAnswer(TEMPLATE, 'goal', 'x'), /target one as "goal.<Field>"/);
  assert.throws(() => applyAnswer(TEMPLATE, 'tools.name', 'x'), /is a table/);
});

test('decision rows escape pipes and the summary stays one line per section', () => {
  assert.equal(
    decisionRow({ date: '2026-10-03', q: 'Q7', target: 'tools', value: 'kb_search | native', by: 'user' }),
    "| 2026-10-03 | Q7: tools = kb_search \\| native | User's answer. | user |",
  );
  let spec = TEMPLATE;
  for (const [target, value] of INTERVIEW) spec = applyAnswer(spec, target, value);
  const summary = specSummary(spec);
  assert.ok(summary.length < spec.length / 2, `summary ${summary.length} chars vs spec ${spec.length}`);
  assert.match(summary, /^evals: 5 rows: delivery, return, broken, unknown, injection$/m);
  assert.match(summary, /^autonomy: Max-steps: 8 · Failure-threshold: 2$/m);
});

test('af answer writes both files and replies with one line naming the next gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-answer-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const af = (...a) => spawnSync(process.execPath, [AF, ...a], { cwd: dir, encoding: 'utf8' });
  af('init');
  const r = af('answer', 'autonomy.Max-steps', '8', '--q', 'Q12');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.match(r.stdout, /^Recorded autonomy\.Max-steps \(Q12\), by user\. Grill gate: \d+ open; next: /);
  assert.match(readFileSync(join(dir, '.agent-forge/AGENT_SPEC.md'), 'utf8'), /^Max-steps: 8$/m);
  assert.match(readFileSync(join(dir, '.agent-forge/decisions.md'), 'utf8'), /\| Q12: autonomy\.Max-steps = 8 \| User's answer\. \| user \|/);
  const bad = af('answer', 'nope.X', 'y');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /section "nope" not found/);
  assert.match(af('spec').stdout, /^autonomy: Max-steps: 8/m);
  assert.match(af('spec', 'autonomy').stdout, /^## autonomy\n/);
});
