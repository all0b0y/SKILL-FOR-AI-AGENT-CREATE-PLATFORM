import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
// TS 7 is the typechecker; the separate TS 6 alias supplies the JS compiler API.
import ts from 'typescript-compiler';
import { checkApiContract } from './api-contract.mjs';

const root = resolve('src');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}
const files = walk(root);
const graph = new Map();
const clients = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (/^['"]use client['"]/.test(text)) clients.push(file);
  const imports = [];
  source.forEachChild((node) => {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) imports.push(spec.text);
    }
  });
  graph.set(
    file,
    imports.map((specifier) => {
      const path = specifier.startsWith('@/')
        ? resolve(root, specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(dirname(file), specifier)
          : specifier;
      return (
        [path, `${path}.ts`, `${path}.tsx`, join(path, 'index.ts')].find((p) => files.includes(p)) ??
        specifier
      );
    }),
  );
}
function clientCheck(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  for (const dep of graph.get(file) ?? []) {
    assert(
      !/^(node:|pg$|pg-boss$|drizzle-orm|@ai-sdk\/anthropic)/.test(dep),
      `Client imports server dependency: ${file} -> ${dep}`,
    );
    assert(
      !dep.startsWith(join(root, 'db')) &&
        !dep.startsWith(join(root, 'runs')) &&
        dep !== join(root, 'env.ts'),
      `Client imports private module: ${file} -> ${dep}`,
    );
    clientCheck(dep, seen);
  }
}
for (const client of clients) clientCheck(client);
const visited = new Set();
function noCycles(file, stack = new Set()) {
  assert(!stack.has(file), `Dependency cycle at ${file}`);
  if (visited.has(file)) return;
  stack.add(file);
  for (const dep of graph.get(file) ?? []) if (graph.has(dep)) noCycles(dep, stack);
  stack.delete(file);
  visited.add(file);
}
for (const file of files) noCycles(file);
const document = existsSync('.agent-forge/ARCHITECTURE.md')
  ? '.agent-forge/ARCHITECTURE.md'
  : 'ARCHITECTURE.md';
const architecture = readFileSync(document, 'utf8');
const hasProductSpec = existsSync('.agent-forge/AGENT_SPEC.md');
assert.equal(
  hasProductSpec,
  document.startsWith('.agent-forge/'),
  'Product spec and architecture must be present together',
);
const apiErrors = checkApiContract(
  new Map(
    files.map((file) => [relative(process.cwd(), file).split(sep).join('/'), readFileSync(file, 'utf8')]),
  ),
  JSON.parse(readFileSync('api-contract.json', 'utf8')),
  {
    spec: readFileSync(hasProductSpec ? '.agent-forge/AGENT_SPEC.md' : 'REFERENCE_SPEC.md', 'utf8'),
    architecture,
  },
  hasProductSpec,
);
assert.equal(apiErrors.length, 0, apiErrors.join('\n'));
const registry = readFileSync('src/agent/tools/registry.ts', 'utf8');
for (const match of registry.matchAll(/name: '([a-z_]+)'[\s\S]*?risk: '(read|write|destructive)'/g))
  assert(
    new RegExp(`\\|\\s*${match[1]}\\s*\\|[^\\n]*\\b${match[2]}\\b`).test(architecture),
    `Undocumented tool/risk: ${match[1]}`,
  );
console.log(
  `Architecture: ${files.length} modules; ${clients.length} client boundaries; no runtime cycles; tool/risk parity, exported TSDoc and spec/module inventory verified.`,
);
