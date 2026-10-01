import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateArchitecture } from '../skills/agent-forge/scripts/lib/architecture.mjs';
import { gapIds, validateSpec } from '../skills/agent-forge/scripts/lib/spec.mjs';

const here = import.meta.dirname;
const read = (p) => readFileSync(join(here, p), 'utf8');
const SPEC = read('fixtures/support-spec.md');
const ARCH = read('fixtures/support-architecture.md');
const TEMPLATE = read('../skills/agent-forge/templates/AGENT_SPEC.md');
const GAPS = gapIds(read('../skills/agent-forge/references/gap-sweep.md'));
const has = (errors, fragment) => errors.some((e) => e.includes(fragment));

test('gap checklist exposes the 12 fixed items', () => {
  assert.equal(GAPS.length, 12);
  assert.ok(GAPS.includes('runaway-loop'));
});

test('complete support spec passes the grill gate', () => {
  assert.deepEqual(validateSpec(SPEC, GAPS), []);
});

test('untouched template fails on every dimension, never passes', () => {
  const errors = validateSpec(TEMPLATE, GAPS);
  for (const dim of ['goal', 'users', 'autonomy', 'budget', 'evals', 'deployment', 'ui']) {
    assert.ok(has(errors, `"${dim}"`), `expected an error for ${dim}`);
  }
  assert.ok(errors.every((e) => e.startsWith('ERROR: ')));
});

test('tool without a scenario is rejected (least privilege)', () => {
  const spec = SPEC.replace('| remember | native | write | запись факта о клиенте |', '| remember | native | write | |');
  assert.ok(has(validateSpec(spec, GAPS), 'tool "remember": no scenario'));
});

test('tools from several services require a service prefix', () => {
  const spec = SPEC.replace('| remember | native | write |', '| remember | mcp:crm | write |');
  assert.ok(has(validateSpec(spec, GAPS), 'need a service prefix'));
});

test('missing gap-sweep item and too many custom items are reported', () => {
  const spec = SPEC.replace('| i18n | answered | русский |\n', '')
    + ['a', 'b', 'c', 'd'].map((x) => `| custom-${x} | answered | x |\n`).join('');
  const errors = validateSpec(spec, GAPS);
  assert.ok(has(errors, 'gap-sweep item "i18n" missing'));
  assert.ok(has(errors, '4 custom items'));
});

test('eval count must be 5-10', () => {
  const spec = SPEC.replace(/\| injection \|.*\n/, '');
  assert.ok(has(validateSpec(spec, GAPS), '4 cases'));
});

test('vercel with background surfaces is rejected', () => {
  const spec = SPEC.replace('Surfaces: chat', 'Surfaces: chat, cron').replace('Target: docker', 'Target: vercel');
  assert.ok(has(validateSpec(spec, GAPS), 'cannot run background surfaces (cron)'));
});

test('accepted defaults count as answers', () => {
  const spec = SPEC.replace('Max-steps: 8', 'Max-steps: default: 20');
  assert.deepEqual(validateSpec(spec, GAPS), []);
});

test('matching architecture passes the architect gate', () => {
  assert.deepEqual(validateArchitecture(ARCH, SPEC), []);
});

test('architecture cannot add tools, skip approval, loosen limits or swap models', () => {
  const arch = ARCH
    .replace('| ticket_create | native | write | yes |', '| ticket_create | native | write | no |')
    .replace('| remember | native | write | yes | 1000 | 0 |', '| remember | native | write | yes | 1000 | 0 |\n| shell_exec | native | destructive | yes | 1000 | 0 |')
    .replace('Max-steps: 8', 'Max-steps: 50')
    .replace('| main | anthropic/claude-opus-5 |', '| main | cheap-model |');
  const errors = validateArchitecture(arch, SPEC);
  assert.ok(has(errors, 'ticket_create" is write: approval must be "yes"'));
  assert.ok(has(errors, 'tool "shell_exec" is not in AGENT_SPEC'));
  assert.ok(has(errors, '"max-steps" is 50; spec says 8'));
  assert.ok(has(errors, 'Swap models only after model-bench'));
});

test('rung above 1 needs a why-not-lower; rung 4 needs a multi-agent justification', () => {
  assert.ok(has(validateArchitecture(ARCH.replace(/Why-not-lower: .*/, 'Why-not-lower:'), SPEC), 'State what rung 2 cannot do'));
  assert.ok(has(validateArchitecture(ARCH.replace('Rung: 3', 'Rung: 4'), SPEC), 'Multi-agent-justification'));
});
