import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT, loadSourceGraph, resolveImport, srcRelative } from '@/test/source-graph';

// Four modules export writes and reads WITHOUT the guards that admit them: the
// capability, the validation, the founding order and the transaction all stay in
// the core that calls them. Each is safe because exactly one core reaches it,
// after its own checks and inside its own transaction. A second importer would
// write a studio's rows, claim a project code, record a price change or insert
// cost items with none of them, and nothing else would say so.
//
// What is counted is what a module LOADS: a static import, a re-export or a
// dynamic import whose argument is a literal, by alias or by relative path,
// resolved to the file. A type-only import carries no function and is not
// counted (bulk-history.ts takes the BulkRow type from bulk-apply.ts and the
// PriceTarget type from bulk-core.ts). Test files are not source and are not
// walked.
//
// Two ways round that count are closed below. The one importer must not hand
// the helpers on (`export … from`, `export *`, or an imported name exported
// again), or a second module would reach them through the core, and through
// the projects barrel, while the count stayed at one. And a dynamic import with
// a COMPUTED argument cannot be resolved, so the only module allowed one is the
// message loader.
//
// NOT covered: a helper passed on under another name (`export const again =
// foundStudio`), and anything outside apps/web/src.

const ONLY_IMPORTER_OF = {
  'lib/org/founding-writes.ts': 'lib/org/core.ts',
  'lib/projects/core/create-phases.ts': 'lib/projects/core/create.ts',
  'lib/price-book/bulk-history.ts': 'lib/price-book/bulk-core.ts',
  'lib/price-book/import-rows.ts': 'lib/price-book/import-core.ts',
} as const;

const graph = loadSourceGraph();
const productionPaths = [...graph.files.keys()];

const importersOf = (module: string) =>
  productionPaths
    .filter((path) => graph.importsOf(path).some((loaded) => srcRelative(loaded) === module))
    .map(srcRelative)
    .sort();

/** The statements of `core` that export what `module` exports: by `export … from`, or by exporting an imported name. */
function reExportsOf(core: string, module: string): string[] {
  const corePath = join(SRC_ROOT, core);
  const isModule = (specifier: ts.Expression | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return false;
    const target = resolveImport(corePath, specifier.text);
    return target !== null && srcRelative(target) === module;
  };
  const statements = graph.files.get(corePath)!.statements;
  const imported = new Set<string>();
  for (const statement of statements) {
    if (!ts.isImportDeclaration(statement) || !isModule(statement.moduleSpecifier)) continue;
    const { name, namedBindings } = statement.importClause ?? {};
    if (name) imported.add(name.text);
    if (namedBindings && ts.isNamespaceImport(namedBindings)) imported.add(namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) namedBindings.elements.forEach((element) => imported.add(element.name.text));
  }
  return statements.filter(ts.isExportDeclaration).flatMap((statement) => {
    if (isModule(statement.moduleSpecifier)) return [statement.getText()];
    const named = !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause);
    if (!named) return [];
    const handedOn = statement.exportClause.elements.some((element) => imported.has((element.propertyName ?? element.name).text));
    return handedOn ? [statement.getText()] : [];
  });
}

/** The production modules holding an `import()` whose argument is not a literal. */
function computedImportHolders(): string[] {
  const holders = new Set<string>();
  for (const [path, file] of graph.files) {
    const visit = (node: ts.Node) => {
      const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (dynamic && !(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))) holders.add(srcRelative(path));
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...holders].sort();
}

describe('the write-phase helpers have one importer each', () => {
  it.each(Object.entries(ONLY_IMPORTER_OF))('%s is loaded by %s and by nothing else', (module, core) => {
    expect(productionPaths.map(srcRelative)).toContain(module);
    expect(importersOf(module)).toEqual([core]);
  });

  it.each(Object.entries(ONLY_IMPORTER_OF))('%s is not handed on by %s', (module, core) => {
    expect(reExportsOf(core, module)).toEqual([]);
  });

  it('only the message loader computes the module it imports', () => {
    expect(computedImportHolders()).toEqual(['i18n/request.ts']);
  });
});
