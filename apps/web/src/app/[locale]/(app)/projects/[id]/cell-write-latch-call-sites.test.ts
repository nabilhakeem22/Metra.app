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

/**
 * The call sites whose column list this scan does NOT read a length from,
 * because it is forwarded. Pinned so "it is a pass-through" can never become the
 * answer for a site nobody checked: a forward qualifies only when its parameter
 * has no default AND the function declaring it is bound to the name `saveLine`,
 * so its own callers are sites this scan reads.
 */
const FORWARDING_SITES = [`${SHEET}/use-boq-writes.ts`];

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

/** A parameter a forwarded identifier resolves to, and how to judge it. */
interface EnclosingParameter {
  parameter: ts.ParameterDeclaration;
  /** The name the function declaring it is BOUND to, or null when it has none. */
  boundAs: string | null;
}

/**
 * The name a function is reachable by: `function saveLine(…)`,
 * `saveLine(…) {…}` in an object, `saveLine: (…) => …`, `const saveLine = …`.
 * An arrow with no binding at all answers null — and null is never a
 * pass-through, because nothing can be said about who calls it.
 */
function functionBoundAs(fn: ts.SignatureDeclarationBase): string | null {
  if (
    (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) &&
    fn.name &&
    ts.isIdentifier(fn.name)
  ) {
    return fn.name.text;
  }
  const owner = fn.parent as ts.Node | undefined;
  if (!owner) return null;
  if (ts.isPropertyAssignment(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
  if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
  if (ts.isPropertyDeclaration(owner) && ts.isIdentifier(owner.name)) return owner.name.text;
  return null;
}

/** The parameter `name` resolves to in some function enclosing `node`. */
function enclosingParameter(node: ts.Node, name: string): EnclosingParameter | null {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope)) continue;
    const parameter = scope.parameters.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    if (parameter) return { parameter, boundAs: functionBoundAs(scope) };
  }
  return null;
}

/** An array literal whose length this scan can state. `null` if it cannot. */
function readableLength(node: ts.Node): number | null {
  if (!ts.isArrayLiteralExpression(node)) return null;
  if (node.elements.some((element) => ts.isSpreadElement(element))) return null;
  return node.elements.length;
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
        const length = readableLength(last);
        if (length === null) {
          unreadable.push(`${where}: ${argument} — a spread; its length is not derivable here`);
        } else {
          site.columnCount = length;
        }
        sites.push(site);
      } else if (last && ts.isIdentifier(last)) {
        // A FORWARD. It is a pass-through only on BOTH counts: the parameter has
        // no DEFAULT (a default is a second value, supplied by nobody this scan
        // reads), and the function declaring it is itself bound to the name
        // `saveLine`, so its own callers are call sites this scan reads. Wave 8
        // F1 walked straight through the first version of this branch, which
        // asked only "is it a parameter": a two-column list carried as a
        // parameter DEFAULT was recorded as a pass-through with columnCount null
        // and was never compared to one.
        const enclosing = enclosingParameter(node, last.text);
        if (!enclosing) {
          unreadable.push(
            `${where}: ${argument} — not an array literal and not a forwarded parameter. ` +
              'Inline the column list at the call site so its length can be read here.',
          );
        } else {
          const initializer = enclosing.parameter.initializer;
          if (initializer) {
            const length = readableLength(initializer);
            if (length === null) {
              unreadable.push(
                `${where}: ${argument} — the parameter it forwards has a DEFAULT this scan ` +
                  'cannot read as a list of columns. Inline the column list at the call site.',
              );
            } else {
              // The default IS a column list, so its length is one of the values
              // this site can pass and the rule below must see it.
              site.columnCount = length;
              site.argument = `${last.text} = ${initializer.getText(source).replace(/\s+/g, ' ')}`;
            }
          }
          if (enclosing.boundAs !== FUNCTION_NAME) {
            unreadable.push(
              `${where}: ${argument} — forwards a parameter of ` +
                `${enclosing.boundAs ?? 'an unbound function'}, not of a \`${FUNCTION_NAME}\`. ` +
                'A forward is only a pass-through when every caller is itself a scanned ' +
                'call site; nothing here says who calls that function. Inline the column ' +
                'list at the call site.',
            );
          }
          sites.push(site);
        }
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
  });

  it('can state the length of every site it found — it never shrugs', () => {
    // The rule the wave-8 tester broke (F1): a site this scan cannot resolve used
    // to be recorded with `columnCount = null` and then EXCLUDED from the length
    // rule below, so the only thing standing in front of a live two-column call
    // was the text pin — and adding the new site to that pin made the suite
    // green. Unresolvable is now its own failure, reported by file:line.
    expect(
      unreadable,
      'A saveLine call site cannot be read, so nothing here says how many columns ' +
        'it passes. That is not a pass — see wave 7 L1 and the message on each line.',
    ).toEqual([]);
    // And nothing survives as a pass-through unless it is one: every site is
    // either a length this scan read, or the ONE forward whose callers it reads.
    const unresolved = callSites.filter((site) => site.columnCount === null);
    expect(unresolved.map((site) => site.where)).toHaveLength(FORWARDING_SITES.length);
    expect(unresolved.map((site) => site.path).sort()).toEqual([...FORWARDING_SITES].sort());
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
