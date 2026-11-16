import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ColumnWriteTarget } from './write-target';

// TEST-ONLY. The source a column-write scan reads (./write-sites.ts), parsed
// with the TypeScript parser, and the one thing a scanned file may not hold.
//
// WHAT IT READS: `apps/web/src` and `packages/db/src` (`.ts`, `.tsx`, `.mts`,
// `.cts`), which is every tree that opens a drizzle handle. TESTS ARE EXCLUDED,
// and `apps/web/tests/**/*.dbtest.ts` DELIBERATELY so: those run through
// `SET LOCAL ROLE metra_app` against a database that already has the grant, so
// a dbtest writing a column the grant does not name fails with 42501 in CI,
// loudly, in the same run. Scanning them would add no fence and would red on
// fixtures that write as the owner on purpose.

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');
const SCAN_ROOTS = [resolve(REPO_ROOT, 'apps/web/src'), resolve(REPO_ROOT, 'packages/db/src')];

export interface Scanned {
  /** Repo-relative, with '/': two roots are scanned, so a bare path would not say which package. */
  relative: string;
  source: ts.SourceFile;
  /** Every `const x = <expr>` in the file, for resolving an alias to its root. */
  initializers: Map<string, ts.Expression>;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

export function collapsed(text: string): string {
  return text.replace(/\s+/g, '');
}

export function whereIs(file: Scanned, node: ts.Node): string {
  const { line } = file.source.getLineAndCharacterOfPosition(node.getStart(file.source));
  return `${file.relative}:${String(line + 1)}`;
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

/** One module, parsed. `relative` is the name a failure is reported under. */
export function parse(relative: string, text: string): Scanned {
  const kind = relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, kind);
  const initializers = new Map<string, ts.Expression>();
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer);
    }
  });
  return { relative, source, initializers };
}

let sourceTexts: ReadonlyMap<string, string> | undefined;

/** Every scanned module's text by repo-relative path, read once per test file. */
function allSourceTexts(): ReadonlyMap<string, string> {
  sourceTexts ??= new Map(
    SCAN_ROOTS.flatMap((root) => allSourceFiles(root)).map((path) => [
      path.slice(REPO_ROOT.length + 1).replace(/\\/g, '/'),
      readFileSync(path, 'utf8'),
    ]),
  );
  return sourceTexts;
}

/**
 * The modules whose TEXT spells one of `names`, parsed. A file that spells none
 * of a table's names cannot reach it, and parsing all ~900 source files to
 * learn that would make these tests slow enough to be skipped.
 */
export function sourcesNaming(names: readonly string[]): Scanned[] {
  return [...allSourceTexts()]
    .filter(([, text]) => names.some((name) => text.includes(name)))
    .map(([relative, text]) => parse(relative, text));
}

/** SQL that WRITES the table, in any spelling an operator would use. */
function rawWriteOf(tableSqlName: string): RegExp {
  return new RegExp(
    String.raw`\b(?:update|insert\s+into|delete\s+from|merge\s+into)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?${tableSqlName}"?\b`,
    'i',
  );
}

/**
 * Raw SQL that writes the table is BANNED rather than parsed. A structural scan
 * can follow the ORM however the call is spelled; it can never read an arbitrary
 * string, so the one route it cannot cover is the one route that must not exist.
 *
 * THE BAN IS FILE-LEVEL, on every string and template in the file, whatever runs
 * it. It used to fire only on a tagged `sql` template or a `.execute(…)` call
 * whose OWN text named the table, so a statement built on one line and run on
 * the next walked past it, as did any runner that is not `.execute` (wave 7 M3).
 *
 * It matches a WRITE, not the name: `packages/db/src/scripts` reads catalogue
 * rows of these tables in `sql` templates on purpose, and a read cannot move a
 * column. What it still cannot see is a statement assembled from pieces;
 * nothing short of running the code can.
 */
export function refuseRawSql(file: Scanned, target: ColumnWriteTarget): void {
  const rawWrite = rawWriteOf(target.tableSqlName);
  walk(file.source, (node) => {
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return;
    if (!rawWrite.test(node.getText(file.source))) return;
    throw new Error(
      `${whereIs(file, node)}: raw SQL writes ${target.tableSqlName}. No static reader can derive the ` +
        'columns it writes, so the grant list cannot be kept honest against it — use the ORM',
    );
  });
}
