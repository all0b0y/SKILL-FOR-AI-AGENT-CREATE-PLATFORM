import { describe, expect, it } from 'vitest';
import { checkApiContract } from '../scripts/api-contract.mjs';

const sources = new Map([
  ['src/example.ts', '/** Return the stable public answer. */\nexport function answer() { return 42; }'],
]);
const documents = { spec: '## goal\nA grounded answer.', architecture: '## boundaries\nA pure function.' };
const contract = {
  version: 1,
  scope: 'reference',
  modules: { 'src/example.ts': { spec: ['goal'], architecture: ['boundaries'], exports: ['answer'] } },
};

describe('API contract audit', () => {
  it('accepts descriptive TSDoc containing inline links', () => {
    expect(
      checkApiContract(
        new Map([
          ['src/example.ts', '/** Return the answer; see {@link helper}. */\nexport const answer = 42;'],
        ]),
        contract,
        documents,
        false,
      ),
    ).toEqual([]);
  });
  it('accepts a documented, explicitly mapped export', () => {
    expect(checkApiContract(sources, contract, documents, false)).toEqual([]);
  });
  it('rejects missing docs, stale exports and missing requirement anchors', () => {
    expect(
      checkApiContract(
        new Map([['src/example.ts', 'export const extra = 1;']]),
        contract,
        { ...documents, spec: '## other' },
        false,
      ).join('\n'),
    ).toMatch(/TSDoc/);
    const errors = checkApiContract(
      new Map([['src/example.ts', '/** Public value. */\nexport const extra = 1;']]),
      contract,
      { ...documents, spec: '## other' },
      false,
    ).join('\n');
    expect(errors).toMatch(/exports/);
    expect(errors).toMatch(/goal/);
  });
  it('rejects unmapped and phantom modules in either direction', () => {
    const errors = checkApiContract(
      new Map([['src/new.ts', '/** Public value. */\nexport const value = 1;']]),
      contract,
      documents,
      false,
    ).join('\n');
    expect(errors).toMatch(/Unmapped module: src\/new.ts/);
    expect(errors).toMatch(/Missing module: src\/example.ts/);
  });
  it('cannot use the reference contract for an actual product spec', () => {
    expect(checkApiContract(sources, contract, documents, true).join('\n')).toMatch(/scope/);
  });
  it('requires named reexports and recognizes default exports and bindings', () => {
    const text =
      '/** Public page. */\nexport default function Page() {}\n/** Public pair. */\nexport const {x, y: renamed} = {x: 1, y: 2};\n/** Shared helper. */\nexport { helper as alias } from "./helper";';
    const mapped = {
      ...contract,
      modules: {
        'src/example.ts': {
          ...contract.modules['src/example.ts'],
          exports: ['default', 'x', 'renamed', 'alias'],
        },
      },
    };
    expect(checkApiContract(new Map([['src/example.ts', text]]), mapped, documents, false)).toEqual([]);
    expect(
      checkApiContract(
        new Map([['src/example.ts', '/** Public surface. */\nexport * from "./other";']]),
        contract,
        documents,
        false,
      ).join('\n'),
    ).toMatch(/Wildcard/);
  });
  it('fails closed on empty mappings and duplicate expected exports', () => {
    expect(() => checkApiContract(sources, { ...contract, modules: {} }, documents, false)).toThrow();
    expect(
      checkApiContract(
        sources,
        {
          ...contract,
          modules: {
            'src/example.ts': { ...contract.modules['src/example.ts'], exports: ['answer', 'answer'] },
          },
        },
        documents,
        false,
      ).join('\n'),
    ).toMatch(/Duplicate/);
  });
});
