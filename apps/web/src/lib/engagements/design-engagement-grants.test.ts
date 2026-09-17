import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { designEngagements } from '@metra/db';
import { describe, expect, it } from 'vitest';

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
// THE `.set({…})` GREP IS NOT ENOUGH, and that is the trap this file is built
// around: `revisions.ts` writes through `REVISION_COUNTERS[trigger].increment()`,
// a FACTORY returning a `PgUpdateSetSource`, so its two columns — one of them
// `design_revision_count`, which a hand-written list missed — are invisible to
// any grep for `.set({`. Every non-literal `.set(...)` argument must therefore
// be named in INDIRECT_SET_SOURCES below, and the test fails on one that is not.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/engagements
const SOURCE_ROOT = resolve(here, '../..'); // apps/web/src
const ROLES_SQL = resolve(here, '../../../../../packages/db/src/rls/roles.sql');

/**
 * A `.set(...)` argument that is NOT an object literal, and where its columns
 * are declared. The key is the argument expression exactly as it is written at
 * the update site, with whitespace collapsed.
 *
 * `declaration` is the start of a TOP-LEVEL statement in `file`; everything from
 * it to the first line that is a bare `}` / `};` is searched for property keys
 * that are columns of `design_engagements`. Nothing may be added here without
 * reading the producer and agreeing that its columns are what it writes.
 */
const INDIRECT_SET_SOURCES: Record<string, { file: string; declaration: string }> = {
  'counter.increment(new Date())': {
    file: 'lib/engagements/revisions.ts',
    declaration: 'const REVISION_COUNTERS',
  },
};

/** prop name (`revisionCount`) -> column name (`revision_count`). */
const COLUMN_OF = new Map<string, string>(
  Object.entries(getTableColumns(designEngagements)).map(([prop, column]) => [
    prop,
    column.name,
  ]),
);

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * The text between `text[open]` (an opening bracket) and its match, brackets
 * excluded. String literals, template literals and comments are skipped, so a
 * `)` inside `'…'` or a `//` line does not close the span.
 */
function balanced(text: string, open: number): string {
  const PAIRS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closer = PAIRS[text[open]];
  if (!closer) throw new Error(`balanced: ${text[open]} at ${String(open)} is not an opener`);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      i += 1;
      while (i < text.length && text[i] !== char) i += text[i] === '\\' ? 2 : 1;
      continue;
    }
    if (char in PAIRS) depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`balanced: no match for ${text[open]} at ${String(open)}`);
}

/** An object literal's body split at its OWN commas, comments removed. */
function topLevelElements(body: string): string[] {
  const elements: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '/' && body[i + 1] === '/') {
      const end = body.indexOf('\n', i);
      i = end === -1 ? body.length : end;
      continue;
    }
    if (char === '/' && body[i + 1] === '*') {
      i = body.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      const start = i;
      i += 1;
      while (i < body.length && body[i] !== quote) i += body[i] === '\\' ? 2 : 1;
      current += body.slice(start, i + 1);
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      elements.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  elements.push(current);
  return elements.map((element) => element.trim()).filter((element) => element.length > 0);
}

/**
 * The keys of an object literal's OWN level. BOTH spellings count: `updatedAt:
 * now` and the SHORTHAND `designFee` — three of the thirteen sites use shorthand
 * and a colon-only reader silently misses them, which is precisely how a
 * hand-written grant list goes stale.
 */
function topLevelKeys(body: string, where: string): string[] {
  return topLevelElements(body).map((element) => {
    if (element.startsWith('...')) {
      // A spread hides its keys from every static reader, this one included.
      throw new Error(`the .set({…}) at ${where} spreads "${element}" — not derivable`);
    }
    const named = /^([A-Za-z_$][\w$]*)\s*(:|$)/.exec(element);
    if (!named) {
      throw new Error(`the .set({…}) at ${where} has an unreadable member "${element}"`);
    }
    return named[1];
  });
}

/** Every `identifier:` in a region, at any depth — filtered to columns by the caller. */
function propertyKeysAnywhere(region: string): string[] {
  return [...region.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[2]);
}

interface UpdateSite {
  where: string;
  argument: string;
}

/** Every `update(designEngagements)` site in the app, with its `.set(` argument. */
function updateSites(): UpdateSite[] {
  const sites: UpdateSite[] = [];
  for (const path of sourceFiles(SOURCE_ROOT)) {
    const text = readFileSync(path, 'utf8');
    const relative = path.slice(SOURCE_ROOT.length + 1).replace(/\\/g, '/');
    let from = 0;
    for (;;) {
      const at = text.indexOf('update(designEngagements)', from);
      if (at === -1) break;
      from = at + 1;
      const setAt = text.indexOf('.set(', at);
      if (setAt === -1) {
        throw new Error(`update(designEngagements) at ${relative} has no .set(`);
      }
      const line = text.slice(0, at).split('\n').length;
      sites.push({
        where: `${relative}:${String(line)}`,
        argument: balanced(text, setAt + '.set'.length).trim(),
      });
    }
  }
  return sites;
}

/** The columns an INDIRECT_SET_SOURCES entry's producer writes. */
function columnsOfIndirectSource(expression: string): string[] {
  const source = INDIRECT_SET_SOURCES[expression];
  const text = readFileSync(resolve(SOURCE_ROOT, source.file), 'utf8');
  const at = text.indexOf(source.declaration);
  if (at === -1) {
    throw new Error(`${source.file} no longer declares ${source.declaration}`);
  }
  const end = /^\}[;,]?\s*$/m.exec(text.slice(at))?.index;
  if (end === undefined) {
    throw new Error(`${source.declaration} in ${source.file} has no top-level end`);
  }
  const columns = propertyKeysAnywhere(text.slice(at, at + end))
    .map((prop) => COLUMN_OF.get(prop))
    .filter((column): column is string => column !== undefined);
  if (columns.length === 0) {
    throw new Error(`${source.declaration} names no design_engagements column`);
  }
  return columns;
}

/** The column list of `grant update (…) on public.design_engagements`. */
function grantedColumns(): string[] {
  const text = readFileSync(ROLES_SQL, 'utf8');
  const match =
    /grant\s+update\s*\(([^)]*)\)\s*on\s+public\.design_engagements\s+to\s+metra_app\s*;/i.exec(
      text,
    );
  if (!match) {
    throw new Error(
      'roles.sql has no `grant update (…) on public.design_engagements to metra_app;`',
    );
  }
  return match[1]
    .split(',')
    .map((name) => name.replace(/--[^\n]*/g, '').trim())
    .filter((name) => name.length > 0);
}

describe('design_engagements column grants match what the app writes', () => {
  const sites = updateSites();

  it('finds the update sites it is meant to be checking', () => {
    // A guard on the guard: a rename of `designEngagements` or a move of the
    // source root would otherwise make every assertion below pass vacuously.
    expect(sites.length).toBeGreaterThanOrEqual(13);
  });

  it('can derive EVERY .set(…) argument — a new indirect producer must be declared', () => {
    const undeclared = sites
      .filter((site) => !site.argument.startsWith('{'))
      .map((site) => ({ ...site, key: site.argument.replace(/\s+/g, ' ') }))
      .filter((site) => !(site.key in INDIRECT_SET_SOURCES))
      .map((site) => `${site.where}: .set(${site.key})`);
    expect(undeclared).toEqual([]);

    // And nothing is declared that no site uses any more: a stale entry would
    // keep granting a column the app stopped writing.
    const used = new Set(
      sites.map((site) => site.argument.replace(/\s+/g, ' ')).filter((key) => key in INDIRECT_SET_SOURCES),
    );
    expect([...Object.keys(INDIRECT_SET_SOURCES)].filter((key) => !used.has(key))).toEqual([]);
  });

  it('grants exactly the columns the update sites write — no more, no fewer', () => {
    const written = new Set<string>();
    for (const site of sites) {
      if (site.argument.startsWith('{')) {
        for (const prop of topLevelKeys(balanced(site.argument, 0), site.where)) {
          const column = COLUMN_OF.get(prop);
          if (!column) {
            throw new Error(
              `${site.where} sets "${prop}", which is not a column of design_engagements`,
            );
          }
          written.add(column);
        }
      } else {
        for (const column of columnsOfIndirectSource(site.argument.replace(/\s+/g, ' '))) {
          written.add(column);
        }
      }
    }

    const granted = new Set(grantedColumns());
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
    // leave the list above passing while granting the whole row. The revoke must
    // also come BEFORE the column grant, or it removes it again.
    const text = readFileSync(ROLES_SQL, 'utf8');
    expect(text).toMatch(/revoke\s+update\s+on\s+public\.design_engagements\s+from\s+metra_app\s*;/i);
    expect(text).not.toMatch(
      /grant[^;(]*\bupdate\b[^;(]*\s+on\s+public\.design_engagements\s+to\s+metra_app\s*;/i,
    );
    const revokeAt = text.search(/revoke\s+update\s+on\s+public\.design_engagements/i);
    const grantAt = text.search(/grant\s+update\s*\([^)]*\)\s*on\s+public\.design_engagements/i);
    expect(revokeAt).toBeLessThan(grantAt);
  });

  it('never grants a column the schema does not have', () => {
    const unknown = grantedColumns().filter(
      (column) => ![...COLUMN_OF.values()].includes(column),
    );
    expect(unknown).toEqual([]);
  });
});
