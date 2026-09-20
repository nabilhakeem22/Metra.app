import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE L1 LATENT DEFECT, TURNED FROM A PARAGRAPH INTO A FENCE.
//
// `cell-write-latch.ts` holds a write by column OVERLAP and coalesces it by the
// EXACT sorted column list. Those two rules are not the same rule, and where they
// disagree the latch can send an EARLIER value after a LATER one. Typed on one
// line, in this order:
//
//     1st  ['qty']              qty = 12   (in flight)
//     2nd  ['qty','unitPrice']  qty = 13   (queued, its own entry)
//     3rd  ['qty']              qty = 14   (queued behind, its own entry)
//     4th  ['qty','unitPrice']  qty = 15   (coalesces onto the 2nd — in FRONT)
//
// the send order is 12, 15, 14, and the document ends holding 14 — the value the
// studio replaced, with nothing on screen saying so.
//
// IT IS LATENT FOR EXACTLY ONE REASON: no `saveLine` call site passes more than
// one column, so no two strands of a line ever overlap. That is a property of the
// CALL SITES, not of the latch, and wave 7 recorded it in a comment. A comment
// does not survive the engineer who did not read it — the first two-column
// control anyone adds makes the defect live, silent, and on the money path.
//
// So this file measures the property the latch depends on. It reds the moment any
// call site passes two columns, and it says in the failure what has to happen
// first: coalesce by OVERLAP (fold an arriving write into the EARLIEST entry it
// overlaps, keeping the queue in arrival order) in the same commit that adds the
// control.
//
// THE TYPESCRIPT AST, NOT A STRING SEARCH, for the reason
// `lib/engagements/design-engagement-grants.test.ts` gives at length: a literal
// search can only be extended one evasion at a time, while the compiler's own
// parser sees the call however it is spelled — across lines, with a space inside
// the parentheses, through `api.saveLine` or a bare `saveLine`.
//
// AND IT REFUSES TO GUESS. A column argument that is neither an array literal nor
// a plain forward of an enclosing function's own parameter is reported by
// file:line with its source text, not skipped. `const columns = [...]` a few
// lines up would otherwise be a hole the size of the defect.
//
// TESTS ARE SCANNED TOO — unlike the grant scan, which excludes them because its
// dbtests fail loudly at the database in the same CI run. Nothing fails loudly
// here: the symptom of L1 is a number that is quietly wrong. A two-column call in
// a test file is a two-column call, and the day one is written it will be because
// somebody is fixing the latch, which is exactly when this expectation should be
// moved by hand rather than passed by accident.

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../../../../../../..');
const SCAN_ROOT = resolve(REPO_ROOT, 'apps/web/src');

/** The write whose column list decides which latch strand it joins. */
const FUNCTION_NAME = 'saveLine';

/** The directory every one of these lives in, so the list below stays readable. */
const SHEET = 'apps/web/src/app/[locale]/(app)/projects/[id]';

/**
 * Every production call site today, as `<repo-relative path> <argument>`: THREE
 * that construct a column list, and ONE that forwards the list it was handed.
 * Pinned so a new control cannot appear without a human reading this file — the
 * count rule below catches a two-column list on the day it is written, and this
 * catches the control that someone will later want to give a second column.
 */
const PRODUCTION_CALL_SITES = [
  // The Provisional toggle names NO cell: `[]` is its own strand, and two
  // toggles of one boolean are a lost update that races nothing else.
  `${SHEET}/boq-sheet-row-controls.tsx []`,
  // The unit select — the one control that saves a named cell directly.
  `${SHEET}/boq-sheet-row-fields.tsx ['unit']`,
  // The blur path: exactly the one column that changed, never a pair.
  `${SHEET}/boq-write-actions.ts [column]`,
  // A FORWARD, not a fourth list: `use-boq-writes.ts` hands the row API's own
  // `columns` parameter straight through to the call above. It constructs
  // nothing, so its length is whatever one of the three chose.
  `${SHEET}/use-boq-writes.ts columns`,
];

interface CallSite {
  /** `<repo-relative path>:<line>`, 1-based, as an editor would jump to it. */
  where: string;
  path: string;
  /** The source text of the column-list argument. */
  argument: string;
  /** Elements in the array literal, or null when the list is forwarded. */
  columnCount: number | null;
  isTest: boolean;
}

/** Every TypeScript module under `root`, tests INCLUDED — see the header. */
function allSourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...allSourceFiles(path));
    else if (/\.(tsx?|mts|cts)$/.test(entry)) found.push(path);
  }
  return found;
}

/** Does this call expression call `saveLine`, however it is reached? */
function callsSaveLine(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === FUNCTION_NAME;
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === FUNCTION_NAME
  );
}

/** Is `name` a parameter of some function enclosing `node`? */
function isEnclosingParameter(node: ts.Node, name: string): boolean {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope)) continue;
    const declared = scope.parameters.some(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
    );
    if (declared) return true;
  }
  return false;
}

const unreadable: string[] = [];

/** Every `saveLine(…)` call in one file, with its column-list argument read. */
function callSitesIn(path: string): CallSite[] {
  const relativePath = relative(REPO_ROOT, path).replace(/\\/g, '/');
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: CallSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callsSaveLine(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const where = `${relativePath}:${String(line)}`;
      const last = node.arguments[node.arguments.length - 1];
      const argument = last ? last.getText(source).replace(/\s+/g, ' ') : '(no arguments)';
      const site: CallSite = {
        where,
        path: relativePath,
        argument,
        columnCount: null,
        isTest: /\.(test|dbtest)\.(tsx?|mts|cts)$/.test(relativePath),
      };
      if (last && ts.isArrayLiteralExpression(last)) {
        if (last.elements.some((element) => ts.isSpreadElement(element))) {
          unreadable.push(`${where}: ${argument} — a spread; its length is not derivable here`);
        } else {
          site.columnCount = last.elements.length;
        }
        sites.push(site);
      } else if (last && ts.isIdentifier(last) && isEnclosingParameter(node, last.text)) {
        // A pass-through: the list came from this function's own caller, which is
        // itself a call site this scan reads.
        sites.push(site);
      } else {
        unreadable.push(
          `${where}: ${argument} — not an array literal and not a forwarded parameter. ` +
            'Inline the column list at the call site so its length can be read here.',
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

const callSites = allSourceFiles(SCAN_ROOT).flatMap(callSitesIn);

describe('every saveLine call site passes at most ONE column (wave 7 L1)', () => {
  it('finds the call sites it is meant to be checking', () => {
    // A guard on the guard: a wrong root, a rename, or a walk that silently read
    // nothing would make every assertion below pass by checking an empty list.
    expect(callSites.length).toBeGreaterThan(3);
    expect(unreadable).toEqual([]);
  });

  it('reads the production call sites, and only those', () => {
    const production = callSites
      .filter((site) => !site.isTest)
      .map((site) => `${site.path} ${site.argument}`)
      .sort();
    expect(production).toEqual([...PRODUCTION_CALL_SITES].sort());
  });

  it('passes no more than one column anywhere, which is what keeps L1 latent', () => {
    const tooMany = callSites
      .filter((site) => site.columnCount !== null && site.columnCount > 1)
      .map((site) => `${site.where}: ${site.argument} (${String(site.columnCount)} columns)`);
    expect(
      tooMany,
      'A saveLine call now passes more than one column, which makes wave 7 L1 LIVE: ' +
        'cell-write-latch.ts holds by column OVERLAP and coalesces by the EXACT sorted ' +
        'column list, so two overlapping-but-differently-shaped writes to one line can ' +
        'be sent out of order and the document keeps the value the studio replaced. ' +
        'Fix the latch first — coalesce into the EARLIEST entry the arriving write ' +
        'overlaps, keeping the queue in arrival order — in the same commit as the ' +
        'control that needs two columns, then move this expectation by hand.',
    ).toEqual([]);
  });

  it('reads the three constructed lists as LENGTHS, not as text', () => {
    // The pin above compares source TEXT, which a rename or a reformat would
    // move. This is the same three sites read the way the latch reads them.
    const lengths = new Map(
      callSites
        .filter((site) => !site.isTest && site.columnCount !== null)
        .map((site) => [site.path, site.columnCount]),
    );
    expect(lengths.get(`${SHEET}/boq-sheet-row-controls.tsx`)).toBe(0);
    expect(lengths.get(`${SHEET}/boq-sheet-row-fields.tsx`)).toBe(1);
    expect(lengths.get(`${SHEET}/boq-write-actions.ts`)).toBe(1);
    expect(lengths.size).toBe(3);
  });
});
