import ts from 'typescript';
import { collapsed, refuseRawSql, sourcesNaming, walk, whereIs, type Scanned } from './scan-sources';
import { columnsOfSet, setSourceHelpers, type SetContext } from './set-columns';
import { bindingsIn, classify, tableExportNames, type Bindings } from './table-bindings';
import type { ColumnWriteTarget } from './write-target';

// TEST-ONLY. Every site in the app that writes columns of ONE table through an
// UPDATE, derived from the source with the TypeScript parser, so a column-level
// grant in rls/roles.sql can be compared against what the code really writes
// before the grant is applied. A hand-kept column list against a growing set of
// update sites is an outage with a fuse on it: add a column to a `.set({…})`,
// deploy, and the write fails with 42501 in production, not in review.
//
// WHY A SOURCE PARSE AND NOT A RUNTIME PROBE. These sites live inside
// `server-only` cores that need a transaction, so only the dbtest suite can
// execute them, and that suite runs against a database that already HAS the
// grant: it proves nothing about the list. The text is the only artefact
// available before the grant is applied, which is exactly when this has to fail.
//
// WHAT COUNTS AS A WRITE: `.update(<table>).set(…)`, and the upsert
// `.insert(<table>)…onConflictDoUpdate({ set })`, whose `set` is an UPDATE by
// another name. Everything this cannot read is refused, never skipped.

export interface WriteSite {
  where: string;
  columns: string[];
}

/** `a.b(c).d(e)`: the calls that follow `a.b(c)`, keyed by method name. */
function methodChain(call: ts.CallExpression): Map<string, ts.CallExpression> {
  const chain = new Map<string, ts.CallExpression>();
  let current: ts.Node = call;
  for (;;) {
    const access = current.parent;
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== current) break;
    const next = access.parent;
    if (!next || !ts.isCallExpression(next) || next.expression !== access) break;
    if (!chain.has(access.name.text)) chain.set(access.name.text, next);
    current = next;
  }
  return chain;
}

/** A one-argument `.update(x)` or `.insert(x)` call, with the builder calls that follow it. */
interface BuilderCall {
  method: 'update' | 'insert';
  tableArgument: ts.Expression;
  chain: Map<string, ts.CallExpression>;
}

function builderCallAt(node: ts.Node): BuilderCall | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  if ((method !== 'update' && method !== 'insert') || node.arguments.length !== 1) return null;
  return { method, tableArgument: node.arguments[0], chain: methodChain(node) };
}

/** The expression holding the `set` of a builder call that has one: `.set(<this>)`, or the upsert's `set: <this>`. */
function setExpressionOf(method: BuilderCall['method'], setCall: ts.CallExpression, where: string): ts.Expression {
  const argument = setCall.arguments[0];
  if (method === 'update') {
    if (!argument) throw new Error(`${where}: .set() takes no argument`);
    return argument;
  }
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    throw new Error(`${where}: onConflictDoUpdate's argument is not an object literal`);
  }
  const set = argument.properties.find(
    (property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'set',
  );
  if (!set || !ts.isPropertyAssignment(set)) throw new Error(`${where}: onConflictDoUpdate has no readable "set"`);
  return set.initializer;
}

/**
 * The write `node` makes to the table, or null when it makes none.
 *
 * `createHash(...).update(bytes)` is an `.update()` too. What tells the two
 * apart is the drizzle builder that must follow: an update with no `.set` in
 * its chain is not a query at all, so it is not this table's business, UNLESS
 * its argument IS the table, which is then a chain this cannot read. A plain
 * INSERT with no `onConflictDoUpdate` writes no column through UPDATE; an
 * insert whose builder is not followed HERE might carry one, and is refused.
 */
function writeSiteAt(node: ts.Node, bindings: Bindings, context: SetContext): WriteSite | null {
  const builder = builderCallAt(node);
  if (!builder) return null;
  const { method, tableArgument, chain } = builder;
  const setCall = method === 'update' ? chain.get('set') : chain.get('onConflictDoUpdate');
  const resolution = classify(tableArgument, bindings, context.target);
  const where = whereIs(context.file, node);
  if (!setCall) {
    if (resolution !== 'table') return null;
    if (method === 'insert' && chain.size > 0) return null;
    throw new Error(
      `${where}: ${method}(<${context.target.tableSqlName}>) has no ` +
        `${method === 'update' ? '.set(…)' : 'readable builder'} in its chain — ` +
        'the columns it writes are not derivable',
    );
  }
  if (resolution === 'unknown') {
    throw new Error(
      `${where}: ${method}(${collapsed(tableArgument.getText(context.file.source))}) writes ` +
        'through a target this scan cannot resolve to a table — name the table directly',
    );
  }
  if (resolution === 'other') return null;
  return { where, columns: columnsOfSet(setExpressionOf(method, setCall, where), where, context) };
}

/** Every write to the table in `files`. Raw SQL that writes it is refused first, file by file. */
export function writeSitesIn(files: Scanned[], target: ColumnWriteTarget): WriteSite[] {
  const exportNames = tableExportNames(files, target);
  const helpers = setSourceHelpers(files, target);
  const sites: WriteSite[] = [];
  for (const file of files) {
    refuseRawSql(file, target);
    const bindings = bindingsIn(file, exportNames);
    walk(file.source, (node) => {
      const site = writeSiteAt(node, bindings, { file, helpers, target });
      if (site) sites.push(site);
    });
  }
  return sites;
}

/**
 * The files worth parsing: those whose TEXT names the table under any of its
 * export aliases, or names it in SQL. Grown to a fixed point, so a re-export
 * alias pulls its own consumers in.
 */
function scanTargets(target: ColumnWriteTarget): Scanned[] {
  let names = [target.tableExport, target.tableSqlName];
  let files: Scanned[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    files = sourcesNaming(names);
    const grown = [...tableExportNames(files, target), target.tableSqlName];
    if (grown.length === names.length) return files;
    names = grown;
  }
  return files;
}

/** Every site in `apps/web/src` and `packages/db/src` that writes columns of the table through an UPDATE. */
export function updateWriteSites(target: ColumnWriteTarget): WriteSite[] {
  return writeSitesIn(scanTargets(target), target);
}
