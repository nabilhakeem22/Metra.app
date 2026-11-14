import ts from 'typescript';
import { walk, type Scanned } from './scan-sources';
import type { ColumnWriteTarget } from './write-target';

// TEST-ONLY. Which local names in a file ARE the scanned table, however the
// file reaches it (./write-sites.ts). A literal search for `update(<table>)`
// was walked past four ways in one sitting (wave 7 R1, F3): a local alias, a
// space inside the call, an upsert, and raw SQL. The compiler's own parser sees
// the call however it is spelled; this file answers what its argument is.

/** Local names in ONE file, classified. */
export interface Bindings {
  /** Names bound to the scanned table object. */
  table: Set<string>;
  /** `import * as x` names: `x.<tableExport>` is the table. */
  namespaces: Set<string>;
  /** Names bound to something that is NOT this table (another drizzle table). */
  other: Set<string>;
}

/** What one import declaration binds: the table, another export, or a namespace. */
function bindImports(clause: ts.ImportClause, exportNames: ReadonlySet<string>, bindings: Bindings): void {
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    bindings.namespaces.add(clause.namedBindings.name.text);
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (clause.isTypeOnly || element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (exportNames.has(imported)) bindings.table.add(element.name.text);
      else bindings.other.add(element.name.text);
    }
  }
}

/** What one `const` binds to the table: a destructured export, the export itself, or `x.<export>`. */
function bindDeclaration(node: ts.VariableDeclaration, exportNames: ReadonlySet<string>, bindings: Bindings): void {
  if (ts.isObjectBindingPattern(node.name)) {
    for (const element of node.name.elements) {
      const key = element.propertyName ?? element.name;
      if (!ts.isIdentifier(key) || !ts.isIdentifier(element.name)) continue;
      if (exportNames.has(key.text)) bindings.table.add(element.name.text);
    }
    return;
  }
  if (!ts.isIdentifier(node.name) || !node.initializer) return;
  const initializer = node.initializer;
  if (ts.isIdentifier(initializer) && exportNames.has(initializer.text)) {
    bindings.table.add(node.name.text);
  } else if (ts.isPropertyAccessExpression(initializer) && exportNames.has(initializer.name.text)) {
    bindings.table.add(node.name.text);
  }
}

/** A chain of aliases (`const a = <table>; const b = a;`) resolves by repeating until nothing new is named. */
function followAliases(file: Scanned, bindings: Bindings): void {
  for (let pass = 0; pass < 4; pass += 1) {
    let grew = false;
    for (const [name, initializer] of file.initializers) {
      if (bindings.table.has(name)) continue;
      if (ts.isIdentifier(initializer) && bindings.table.has(initializer.text)) {
        bindings.table.add(name);
        bindings.other.delete(name);
        grew = true;
      }
    }
    if (!grew) break;
  }
}

/**
 * Which local names in ONE file are the table, given the names the table is
 * exported under. `import`, `import * as`, `const t = <table>` and
 * `const { <table>: t } = schema` all land here; anything else a file does to
 * reach the table is caught later, as an unresolvable `.update()`.
 */
export function bindingsIn(file: Scanned, exportNames: ReadonlySet<string>): Bindings {
  const bindings: Bindings = { table: new Set(), namespaces: new Set(), other: new Set() };
  walk(file.source, (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) bindImports(node.importClause, exportNames, bindings);
    else if (ts.isVariableDeclaration(node)) bindDeclaration(node, exportNames, bindings);
  });
  followAliases(file, bindings);
  return bindings;
}

/** Adds the names one node re-exports the table under: `export { t as u }`, or `const u = t`. */
function addReExportedNames(node: ts.Node, names: Set<string>, local: ReadonlySet<string>): void {
  if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      const from = (element.propertyName ?? element.name).text;
      if (names.has(from) || local.has(from)) names.add(element.name.text);
    }
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isIdentifier(node.initializer) &&
    local.has(node.initializer.text)
  ) {
    names.add(node.name.text);
  }
}

/**
 * Every name the table is exported or RE-exported under, tree-wide. Seeded with
 * the drizzle export and grown to a fixed point, so `export { <table> as
 * engagements }` in one file makes `engagements` a table name in the next.
 */
export function tableExportNames(files: Scanned[], target: ColumnWriteTarget): Set<string> {
  const names = new Set([target.tableExport]);
  for (let pass = 0; pass < 4; pass += 1) {
    const before = names.size;
    for (const file of files) {
      const local = bindingsIn(file, names).table;
      walk(file.source, (node) => {
        addReExportedNames(node, names, local);
      });
    }
    if (names.size === before) break;
  }
  return names;
}

export type Resolution = 'table' | 'other' | 'unknown';

/** What the argument of `.update(…)` / `.insert(…)` is: this table, another one, or unreadable. */
export function classify(expression: ts.Expression, bindings: Bindings, target: ColumnWriteTarget): Resolution {
  if (ts.isIdentifier(expression)) {
    if (bindings.table.has(expression.text)) return 'table';
    if (bindings.other.has(expression.text)) return 'other';
    return 'unknown';
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    if (bindings.namespaces.has(expression.expression.text)) {
      return expression.name.text === target.tableExport ? 'table' : 'other';
    }
  }
  return 'unknown';
}
