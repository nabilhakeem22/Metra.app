import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { getTableColumns } from 'drizzle-orm';
import { designEngagements } from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  grantedUpdateColumns,
  tableLevelUpdateGrants,
  updateRevokes,
} from '../../../../../packages/db/src/scripts/design-engagement-grant';

// THE GRANT AND THE CODE, KEPT HONEST BY A MACHINE.
//
// `rls/roles.sql` grants metra_app a COLUMN-LEVEL update on
// `design_engagements`: fifteen derived columns and nothing else, so the client,
// the project, the number, `created_at` and — the ones that matter — the two
// free-revision ALLOWANCES cannot be moved by any future code path or by SQL
// injected past the ORM.
//
// A hand-maintained column list against a growing set of update sites is an
// outage with a fuse on it: add a column to a `.set({…})`, deploy, and the write
// fails with 42501 in production, not in review. So the list is not trusted —
// it is DERIVED here, from the source, and compared. If they diverge this test
// prints both directions of the diff, and the fix is one line in roles.sql or
// one column removed from a core.
//
// WHY A SOURCE PARSE AND NOT A RUNTIME PROBE. Every one of these sites lives
// inside a `server-only` core that needs a transaction, so nothing short of the
// dbtest suite can execute them — and the dbtest suite runs against a database
// that already HAS the grant, so it would prove nothing about the list. The text
// is the only artefact available before the grant is applied, which is exactly
// when this has to fail.
//
// WHY THE TYPESCRIPT AST AND NOT A STRING SEARCH. The first version of this file
// looked for the literal `update(designEngagements)`. Wave 7's testers walked
// past it four ways in one sitting (R1, F3): a local alias
// (`const table = designEngagements`), a space inside the call
// (`update( designEngagements )`), an upsert
// (`insert(designEngagements)…onConflictDoUpdate({ set })`), and raw
// `sql` naming the table — each of them writing `free_revision_n`, the allowance
// column the grant exists to protect, with the suite still green. A literal
// search can only ever be extended one evasion at a time; the compiler's own
// parser sees the call however it is spelled.
//
// WHAT THIS FILE REFUSES TO GUESS. It throws — by file:line, with the expression
// text — rather than deriving a short list, on: a spread or computed key in a
// `set` (written at the call site OR inside an annotated producer), a
// `.update(…)` argument it cannot resolve to a table, a `.set(…)` argument that
// is not an object literal and not produced by a helper ANNOTATED
// `PgUpdateSetSource<typeof designEngagements>`, and any string anywhere in a
// scanned file that spells a WRITE to the table. A grant list derived from a
// scan that shrugs is worth nothing.
//
// WHAT IT READS: `apps/web/src` and `packages/db/src` — `.ts`, `.tsx`, `.mts`,
// `.cts` — which is every tree that opens a drizzle handle to this table.
// TESTS ARE EXCLUDED, and `apps/web/tests/**/*.dbtest.ts` DELIBERATELY so: those
// run through `SET LOCAL ROLE metra_app` against a database that already has the
// grant, so a dbtest writing a column the grant does not name fails with 42501 in
// CI — loudly, in the same run, which is the signal this scan exists to produce
// five steps earlier. Scanning them would add no fence and would red on fixtures
// that write as the owner on purpose.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/engagements
const REPO_ROOT = resolve(here, '../../../../..');
const SCAN_ROOTS = [resolve(REPO_ROOT, 'apps/web/src'), resolve(REPO_ROOT, 'packages/db/src')];
const ROLES_SQL = resolve(REPO_ROOT, 'packages/db/src/rls/roles.sql');

/** The drizzle table object's exported name, and the table it maps to. */
const TABLE_EXPORT = 'designEngagements';
const TABLE_SQL_NAME = 'design_engagements';

/**
 * The annotation that makes a `set` producer readable, whitespace removed.
 * A helper returning this type is the ONE indirect route allowed — its object
 * literals are read for column keys — because the type names the table, so a
 * producer for some other table cannot be mistaken for one of these.
 */
const SET_SOURCE_TYPE = `PgUpdateSetSource<typeof${TABLE_EXPORT}>`;

/** prop name (`revisionCount`) -> column name (`revision_count`). */
const COLUMN_OF = new Map<string, string>(
  Object.entries(getTableColumns(designEngagements)).map(([prop, column]) => [
    prop,
    column.name,
  ]),
);

interface Scanned {
  relative: string;
  source: ts.SourceFile;
  /** Every `const x = <expr>` in the file, for resolving an alias to its root. */
  initializers: Map<string, ts.Expression>;
}

/** Local names in ONE file, classified. */
interface Bindings {
  /** Names bound to the design_engagements table object. */
  table: Set<string>;
  /** `import * as x` names — `x.designEngagements` is the table. */
  namespaces: Set<string>;
  /** Names bound to something that is NOT this table (another drizzle table). */
  other: Set<string>;
}

/** Every TypeScript module under `root`, tests excluded. */
function allSourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...allSourceFiles(path));
    // `.mts` and `.cts` count: the extension filter, not the tree walk, was the
    // weaker half of this scan's reach.
    else if (/\.(tsx?|mts|cts)$/.test(entry) && !/\.(test|dbtest)\.(tsx?|mts|cts)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

function collapsed(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * Which local names in ONE file are the table, given the names the table is
 * exported under. `import`, `import * as`, `const t = designEngagements` and
 * `const { designEngagements: t } = schema` all land here; anything else a file
 * does to reach the table is caught later, as an unresolvable `.update()`.
 */
function bindingsIn(file: Scanned, exportNames: ReadonlySet<string>): Bindings {
  const bindings: Bindings = { table: new Set(), namespaces: new Set(), other: new Set() };
  walk(file.source, (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
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
      return;
    }
    if (!ts.isVariableDeclaration(node)) return;
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
    } else if (
      ts.isPropertyAccessExpression(initializer) &&
      exportNames.has(initializer.name.text)
    ) {
      bindings.table.add(node.name.text);
    }
  });
  // A chain of aliases (`const a = designEngagements; const b = a;`) resolves by
  // repeating until nothing new is named.
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
  return bindings;
}

/**
 * Every name the table is exported or RE-exported under, tree-wide. Seeded with
 * the drizzle export and grown to a fixed point, so `export { designEngagements
 * as engagements }` in one file makes `engagements` a table name in the next.
 */
function tableExportNames(files: Scanned[]): Set<string> {
  const names = new Set([TABLE_EXPORT]);
  for (let pass = 0; pass < 4; pass += 1) {
    let grew = false;
    for (const file of files) {
      const local = bindingsIn(file, names).table;
      walk(file.source, (node) => {
        if (
          ts.isExportDeclaration(node) &&
          node.exportClause &&
          ts.isNamedExports(node.exportClause)
        ) {
          for (const element of node.exportClause.elements) {
            const from = (element.propertyName ?? element.name).text;
            if ((names.has(from) || local.has(from)) && !names.has(element.name.text)) {
              names.add(element.name.text);
              grew = true;
            }
          }
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isIdentifier(node.initializer) &&
          local.has(node.initializer.text) &&
          !names.has(node.name.text)
        ) {
          names.add(node.name.text);
          grew = true;
        }
      });
    }
    if (!grew) break;
  }
  return names;
}

type Resolution = 'table' | 'other' | 'unknown';

function classify(expression: ts.Expression, bindings: Bindings): Resolution {
  if (ts.isIdentifier(expression)) {
    if (bindings.table.has(expression.text)) return 'table';
    if (bindings.other.has(expression.text)) return 'other';
    return 'unknown';
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    if (bindings.namespaces.has(expression.expression.text)) {
      return expression.name.text === TABLE_EXPORT ? 'table' : 'other';
    }
  }
  return 'unknown';
}

/** `a.b(c).d(e)` -> the calls that follow `a.b(c)`, keyed by method name. */
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

/** The leftmost identifier of `a.b[c](d)` — `a`. */
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

function whereIs(file: Scanned, node: ts.Node): string {
  const { line } = file.source.getLineAndCharacterOfPosition(node.getStart(file.source));
  return `${file.relative}:${String(line + 1)}`;
}

/**
 * Every `design_engagements` column named as a key anywhere under `node`.
 *
 * A SPREAD or a COMPUTED KEY throws, exactly as it does at a literal `.set({…})`.
 * It used to be SKIPPED here, which made the annotated producer a way round the
 * rule the direct path enforces: `const patch: PgUpdateSetSource<typeof
 * designEngagements> = { ...hidden, state }` derived `['state']` and reported the
 * file clean while `hidden` carried `freeRevisionN` (wave 7 M2).
 */
function columnKeysUnder(node: ts.Node, where: string): string[] {
  const columns: string[] = [];
  walk(node, (child) => {
    if (!ts.isObjectLiteralExpression(child)) return;
    for (const property of child.properties) {
      if (ts.isSpreadAssignment(property)) {
        throw new Error(`the set at ${where} spreads "${property.getText()}" — not derivable`);
      }
      if (property.name && ts.isComputedPropertyName(property.name)) {
        throw new Error(
          `the set at ${where} has a computed key "${property.name.getText()}" — not derivable`,
        );
      }
      const name = ts.isShorthandPropertyAssignment(property)
        ? property.name.text
        : ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
          ? property.name.text
          : undefined;
      const column = name === undefined ? undefined : COLUMN_OF.get(name);
      if (column) columns.push(column);
    }
  });
  return columns;
}

interface SetSourceHelper {
  where: string;
  columns: string[];
}

/**
 * Every declaration ANNOTATED `PgUpdateSetSource<typeof designEngagements>`, with
 * the columns its object literals name. `revisions.ts` writes through
 * `REVISION_COUNTERS[trigger].increment(now)` — a factory whose two columns, one
 * of them `design_revision_count`, no grep for `.set({` can see. The annotation
 * is what makes it readable, and the hand-kept list of such producers this file
 * used to carry is gone with it.
 */
function setSourceHelpers(files: Scanned[]): Map<string, SetSourceHelper> {
  const helpers = new Map<string, SetSourceHelper>();
  for (const file of files) {
    walk(file.source, (node) => {
      if (!ts.isVariableDeclaration(node) && !ts.isFunctionDeclaration(node)) return;
      if (!node.type || !collapsed(node.type.getText(file.source)).includes(SET_SOURCE_TYPE)) return;
      if (!node.name || !ts.isIdentifier(node.name)) return;
      const columns = columnKeysUnder(node, whereIs(file, node));
      if (columns.length === 0) {
        throw new Error(
          `${whereIs(file, node)}: ${node.name.text} is typed ${SET_SOURCE_TYPE} and names no ` +
            `${TABLE_SQL_NAME} column — its set source is not derivable`,
        );
      }
      helpers.set(node.name.text, { where: whereIs(file, node), columns });
    });
  }
  return helpers;
}

/** The columns of a `set` object literal. Spreads and computed keys throw. */
function columnsOfSetLiteral(literal: ts.ObjectLiteralExpression, where: string): string[] {
  return literal.properties.map((property) => {
    if (ts.isSpreadAssignment(property)) {
      throw new Error(`the set at ${where} spreads "${property.getText()}" — not derivable`);
    }
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      throw new Error(`the set at ${where} has an unreadable member "${property.getText()}"`);
    }
    const column = COLUMN_OF.get(name.text);
    if (!column) {
      throw new Error(
        `${where} sets "${name.text}", which is not a column of ${TABLE_SQL_NAME}`,
      );
    }
    return column;
  });
}

/**
 * The columns of a `set` argument that is NOT an object literal: its expression
 * is resolved, through local `const` aliases, back to a declaration annotated
 * `PgUpdateSetSource<typeof designEngagements>`. Anything else throws.
 */
function columnsOfSetExpression(
  argument: ts.Expression,
  file: Scanned,
  helpers: ReadonlyMap<string, SetSourceHelper>,
  where: string,
): string[] {
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
      `does not resolve to a helper typed ${SET_SOURCE_TYPE} — annotate the producer or inline ` +
      'the object',
  );
}

/** SQL that WRITES the table, in any spelling an operator would use. */
const RAW_WRITE =
  /\b(?:update|insert\s+into|delete\s+from|merge\s+into)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?design_engagements"?\b/i;

/**
 * Raw SQL that writes the table is BANNED rather than parsed. A structural scan
 * can follow the ORM however the call is spelled; it can never read an arbitrary
 * string, so the one route it cannot cover is the one route that must not exist.
 *
 * THE BAN IS FILE-LEVEL, on every string and template in the file, whatever runs
 * it. It used to fire only on a tagged `sql` template or a `.execute(…)` call
 * whose OWN text named the table, so `const stmt = sql.raw('update
 * design_engagements …'); db.execute(stmt);` — the same statement over two lines
 * — walked past it, as did any runner that is not `.execute` (wave 7 M3).
 *
 * It matches a WRITE, not the name: `packages/db/src/scripts` reads this table's
 * catalogue rows in `sql` templates on purpose, and a read cannot move a column.
 * What it still cannot see is a statement assembled from pieces
 * (`'upd' + 'ate design_engagements'`); nothing short of running the code can.
 */
function refuseRawSql(file: Scanned): void {
  walk(file.source, (node) => {
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return;
    if (!RAW_WRITE.test(node.getText(file.source))) return;
    throw new Error(
      `${whereIs(file, node)}: raw SQL writes ${TABLE_SQL_NAME}. No static reader can derive the ` +
        'columns it writes, so the grant list cannot be kept honest against it — use the ORM',
    );
  });
}

interface WriteSite {
  where: string;
  columns: string[];
}

/** Every site in the app that writes columns of `design_engagements`. */
function writeSites(files: Scanned[], exportNames: ReadonlySet<string>): WriteSite[] {
  const helpers = setSourceHelpers(files);
  const sites: WriteSite[] = [];
  for (const file of files) {
    refuseRawSql(file);
    const bindings = bindingsIn(file, exportNames);
    walk(file.source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      if ((method !== 'update' && method !== 'insert') || node.arguments.length !== 1) return;
      const chain = methodChain(node);
      const setCall = method === 'update' ? chain.get('set') : chain.get('onConflictDoUpdate');
      const target = classify(node.arguments[0], bindings);
      const where = whereIs(file, node);

      // `createHash(...).update(bytes)` is an `.update()` too. What tells the two
      // apart is the drizzle builder that must follow: an update with no `.set`
      // in its chain is not a query at all, so it is not this table's business —
      // UNLESS its argument IS the table, which is then a chain this cannot read.
      // A plain INSERT with no `onConflictDoUpdate` writes no column through
      // UPDATE and is none of this file's business; an insert whose builder is
      // not followed HERE might carry one, and is refused.
      if (!setCall) {
        if (target !== 'table') return;
        if (method === 'insert' && chain.size > 0) return;
        throw new Error(
          `${where}: ${method}(<${TABLE_SQL_NAME}>) has no ` +
            `${method === 'update' ? '.set(…)' : 'readable builder'} in its chain — ` +
            'the columns it writes are not derivable',
        );
      }
      if (target === 'unknown') {
        throw new Error(
          `${where}: ${method}(${collapsed(node.arguments[0].getText(file.source))}) writes ` +
            'through a target this scan cannot resolve to a table — name the table directly',
        );
      }
      if (target === 'other') return;

      if (method === 'update') {
        const argument = setCall.arguments[0];
        if (!argument) throw new Error(`${where}: .set() takes no argument`);
        sites.push({
          where,
          columns: ts.isObjectLiteralExpression(argument)
            ? columnsOfSetLiteral(argument, where)
            : columnsOfSetExpression(argument, file, helpers, where),
        });
        return;
      }

      // The upsert: `onConflictDoUpdate({ target, set: {…} })`. Its `set` is an
      // UPDATE of this table by another name, and was invisible for a whole wave.
      const options = setCall.arguments[0];
      if (!options || !ts.isObjectLiteralExpression(options)) {
        throw new Error(`${where}: onConflictDoUpdate's argument is not an object literal`);
      }
      const set = options.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'set',
      );
      if (!set || !ts.isPropertyAssignment(set)) {
        throw new Error(`${where}: onConflictDoUpdate has no readable "set"`);
      }
      sites.push({
        where,
        columns: ts.isObjectLiteralExpression(set.initializer)
          ? columnsOfSetLiteral(set.initializer, where)
          : columnsOfSetExpression(set.initializer, file, helpers, where),
      });
    });
  }
  return sites;
}

function parse(path: string, text: string): Scanned {
  // Repo-relative, because two roots are scanned and `lib/engagements/core.ts`
  // alone would no longer say which package a failure is in.
  const relative = path.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
  const source = ts.createSourceFile(
    relative,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const initializers = new Map<string, ts.Expression>();
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer);
    }
  });
  return { relative, source, initializers };
}

/**
 * The files worth parsing: those whose TEXT names the table under any of its
 * export aliases, or names it in SQL. A file that spells none of those cannot
 * reach the table, and parsing all ~900 source files to learn that would make
 * this test slow enough to be skipped. Grown to a fixed point, so a re-export
 * alias pulls its own consumers in.
 */
function scanTargets(): Scanned[] {
  const texts = new Map(
    SCAN_ROOTS.flatMap((root) => allSourceFiles(root)).map((path) => [
      path,
      readFileSync(path, 'utf8'),
    ]),
  );
  let names = [TABLE_EXPORT, TABLE_SQL_NAME];
  let files: Scanned[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    files = [...texts]
      .filter(([, text]) => names.some((name) => text.includes(name)))
      .map(([path, text]) => parse(path, text));
    const grown = [...tableExportNames(files), TABLE_SQL_NAME];
    if (grown.length === names.length) return files;
    names = grown;
  }
  return files;
}

const scanned = scanTargets();
const sites = writeSites(scanned, tableExportNames(scanned));

describe('design_engagements column grants match what the app writes', () => {
  it('finds the update sites it is meant to be checking', () => {
    // A guard on the guard: a rename of `designEngagements` or a move of the
    // source root would otherwise make every assertion below pass vacuously.
    expect(sites.length).toBeGreaterThanOrEqual(13);
  });

  it('grants exactly the columns the update sites write — no more, no fewer', () => {
    const written = new Set(sites.flatMap((site) => site.columns));
    const granted = new Set(grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')));
    const missing = [...written].filter((column) => !granted.has(column)).sort();
    const surplus = [...granted].filter((column) => !written.has(column)).sort();

    // Reported as two named lists rather than a set comparison: which DIRECTION
    // it drifted is the whole diagnosis. `missing` is a 42501 waiting to happen;
    // `surplus` is authority nothing uses.
    expect({ missing, surplus }).toEqual({ missing: [], surplus: [] });
    expect(granted.size).toBe(15);
  });

  it('keeps the table-level UPDATE revoked, so the column list is not cosmetic', () => {
    // A table-level UPDATE subsumes every column grant, so a re-widening would
    // leave the list above passing while granting the whole row. Both readings
    // live in `design-engagement-grant.ts`, which the database-side gate shares,
    // and both are asked of comment-free text.
    const text = readFileSync(ROLES_SQL, 'utf8');
    expect(tableLevelUpdateGrants(text)).toEqual([]);

    // EVERY revoke must come before the column grant, not just the first one:
    // revoking the table-level privilege takes the column grants with it, so one
    // appended below the grant leaves metra_app with no UPDATE at all.
    const revokes = updateRevokes(text);
    expect(revokes.after).toEqual([]);
    expect(revokes.before).toEqual([
      'revoke update on public.design_engagements from metra_app;',
    ]);
  });

  it('never grants a column the schema does not have', () => {
    const unknown = grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')).filter(
      (column) => ![...COLUMN_OF.values()].includes(column),
    );
    expect(unknown).toEqual([]);
  });
});
