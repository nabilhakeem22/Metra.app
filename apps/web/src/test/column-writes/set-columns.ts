import ts from 'typescript';
import { collapsed, walk, whereIs, type Scanned } from './scan-sources';
import type { ColumnWriteTarget } from './write-target';

// TEST-ONLY. Which columns a `set` names (./write-sites.ts). It throws, by
// file:line with the expression text, rather than deriving a short list: on a
// spread or a computed key (at the call site OR inside an annotated producer),
// and on a `.set(…)` argument that is neither an object literal nor produced by
// a helper ANNOTATED `PgUpdateSetSource<typeof <table>>`. A column list derived
// from a scan that shrugs is worth nothing.

/**
 * The annotation that makes a `set` producer readable, whitespace removed: the
 * ONE indirect route allowed, because the type names the table, so a producer
 * for some other table cannot be mistaken for one of these.
 */
function setSourceType(target: ColumnWriteTarget): string {
  return `PgUpdateSetSource<typeof${target.tableExport}>`;
}

/** The leftmost identifier of `a.b[c](d)`: `a`. */
function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  let current: ts.Expression = expression;
  for (let depth = 0; depth < 12; depth += 1) {
    if (ts.isIdentifier(current)) return current;
    if (
      ts.isCallExpression(current) ||
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** The name of one object-literal member when it is plainly written, else undefined. */
function plainMemberName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
    return property.name.text;
  }
  return undefined;
}

/**
 * Every column of the table named as a key anywhere under `node`.
 *
 * A SPREAD or a COMPUTED KEY throws, exactly as it does at a literal `.set({…})`.
 * It used to be SKIPPED here, which made the annotated producer a way round the
 * rule the direct path enforces: a producer written `{ ...hidden, state }`
 * derived `['state']` and reported the file clean while `hidden` carried a
 * column the grant exists to protect (wave 7 M2).
 */
function columnKeysUnder(node: ts.Node, where: string, target: ColumnWriteTarget): string[] {
  const columns: string[] = [];
  walk(node, (child) => {
    if (!ts.isObjectLiteralExpression(child)) return;
    for (const property of child.properties) {
      if (ts.isSpreadAssignment(property)) {
        throw new Error(`the set at ${where} spreads "${property.getText()}" — not derivable`);
      }
      if (property.name && ts.isComputedPropertyName(property.name)) {
        throw new Error(`the set at ${where} has a computed key "${property.name.getText()}" — not derivable`);
      }
      const name = plainMemberName(property);
      const column = name === undefined ? undefined : target.columnOf.get(name);
      if (column) columns.push(column);
    }
  });
  return columns;
}

export interface SetSourceHelper {
  where: string;
  columns: string[];
}

/**
 * Every declaration ANNOTATED `PgUpdateSetSource<typeof <table>>`, with the
 * columns its object literals name. A counter factory read through
 * `COUNTERS[trigger].increment(now)` writes columns no grep for `.set({` sees.
 */
export function setSourceHelpers(files: Scanned[], target: ColumnWriteTarget): Map<string, SetSourceHelper> {
  const annotation = setSourceType(target);
  const helpers = new Map<string, SetSourceHelper>();
  for (const file of files) {
    walk(file.source, (node) => {
      if (!ts.isVariableDeclaration(node) && !ts.isFunctionDeclaration(node)) return;
      if (!node.type || !collapsed(node.type.getText(file.source)).includes(annotation)) return;
      if (!node.name || !ts.isIdentifier(node.name)) return;
      const columns = columnKeysUnder(node, whereIs(file, node), target);
      if (columns.length === 0) {
        throw new Error(
          `${whereIs(file, node)}: ${node.name.text} is typed ${annotation} and names no ` +
            `${target.tableSqlName} column — its set source is not derivable`,
        );
      }
      helpers.set(node.name.text, { where: whereIs(file, node), columns });
    });
  }
  return helpers;
}

/** The columns of a `set` object literal. Spreads and computed keys throw. */
function columnsOfSetLiteral(literal: ts.ObjectLiteralExpression, where: string, target: ColumnWriteTarget): string[] {
  return literal.properties.map((property) => {
    if (ts.isSpreadAssignment(property)) {
      throw new Error(`the set at ${where} spreads "${property.getText()}" — not derivable`);
    }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      throw new Error(`the set at ${where} has an unreadable member "${property.getText()}"`);
    }
    const column = target.columnOf.get(name.text);
    if (!column) throw new Error(`${where} sets "${name.text}", which is not a column of ${target.tableSqlName}`);
    return column;
  });
}

/** What a `set` is read against: the file it is in, the annotated producers, and the table. */
export interface SetContext {
  file: Scanned;
  helpers: ReadonlyMap<string, SetSourceHelper>;
  target: ColumnWriteTarget;
}

/**
 * The columns a `set` argument names: an object literal is read directly, and
 * anything else must resolve, through local `const` aliases, to an annotated producer.
 */
export function columnsOfSet(argument: ts.Expression, where: string, { file, helpers, target }: SetContext): string[] {
  if (ts.isObjectLiteralExpression(argument)) return columnsOfSetLiteral(argument, where, target);
  let current: ts.Expression | undefined = argument;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const root = rootIdentifier(current);
    if (!root) break;
    const helper = helpers.get(root.text);
    if (helper) return helper.columns;
    current = file.initializers.get(root.text);
  }
  throw new Error(
    `${where}: .set(${collapsed(argument.getText(file.source))}) is not an object literal and ` +
      `does not resolve to a helper typed ${setSourceType(target)} — annotate the producer or inline the object`,
  );
}
