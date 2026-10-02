import ts from 'typescript-compiler';
import { z } from 'zod';

const Anchors = z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1);
const Contract = z
  .object({
    version: z.literal(1),
    scope: z.enum(['reference', 'product']),
    modules: z
      .record(
        z.string().regex(/^src\/.+\.tsx?$/),
        z
          .object({
            spec: Anchors,
            architecture: Anchors,
            exports: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .refine((modules) => Object.keys(modules).length > 0),
  })
  .strict();

function names(binding) {
  if (ts.isIdentifier(binding)) return [binding.text];
  return binding.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : names(element.name)));
}

/** Compare explicit module/export inventories and document anchors without executing application code. */
export function checkApiContract(sources, input, documents, hasProductSpec) {
  const contract = Contract.parse(input);
  const errors = [];
  if (contract.scope !== (hasProductSpec ? 'product' : 'reference'))
    errors.push('Contract scope must match the selected reference or product spec');
  const anchors = Object.fromEntries(
    Object.entries(documents).map(([kind, text]) => [
      kind,
      new Set([...text.matchAll(/^##\s+([a-z][a-z0-9-]*)\s*$/gm)].map((match) => match[1])),
    ]),
  );
  for (const [file, text] of sources) {
    const entry = contract.modules[file];
    if (!entry) {
      errors.push(`Unmapped module: ${file}`);
      continue;
    }
    for (const kind of ['spec', 'architecture'])
      for (const anchor of entry[kind])
        if (!anchors[kind]?.has(anchor)) errors.push(`${file}: missing ${kind} anchor ${anchor}`);
    const found = new Set();
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    source.forEachChild((node) => {
      const reexport = ts.isExportDeclaration(node);
      if (!reexport && !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
        return;
      if (!node.jsDoc?.some((doc) => (ts.getTextOfJSDocComment(doc.comment) ?? '').trim().length > 0))
        errors.push(
          `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: missing descriptive TSDoc`,
        );
      if (reexport) {
        if (!node.exportClause) errors.push(`${file}: Wildcard exports must be replaced by named reexports`);
        else if (ts.isNamedExports(node.exportClause))
          node.exportClause.elements.forEach((item) => {
            found.add(item.name.text);
          });
        else found.add(node.exportClause.name.text);
      } else if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
        found.add('default');
      else if (ts.isVariableStatement(node))
        node.declarationList.declarations.forEach((declaration) => {
          for (const name of names(declaration.name)) found.add(name);
        });
      else if (node.name) found.add(node.name.text);
      else errors.push(`${file}: unnamed export cannot be inventoried`);
    });
    if (new Set(entry.exports).size !== entry.exports.length)
      errors.push(`${file}: Duplicate expected exports`);
    if (JSON.stringify([...found].sort()) !== JSON.stringify([...entry.exports].sort()))
      errors.push(
        `${file}: exports differ; actual=${[...found].sort().join(',')} expected=${[...entry.exports].sort().join(',')}`,
      );
  }
  for (const file of Object.keys(contract.modules))
    if (!sources.has(file)) errors.push(`Missing module: ${file}`);
  return errors;
}
