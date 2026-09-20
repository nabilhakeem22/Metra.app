import { afterEach, describe, expect, it, vi } from 'vitest';
import { declaredFunctions } from './rls-catalogue';
import { ORGANIZATIONS_VISIBLE_QUERY } from './org-orphan-rows';
import {
  declaredCompositeSetNullFks,
  declaredIndexes,
  declaredTables,
  orgScopedTableNames,
} from './schema-catalogue';
import { runSchemaCheck, type CatalogueSql } from './schema-check';

// F2: on the ONE run where the owner is being told the database is behind, the
// script printed ONE of its four sections. The other three were queried at the
// top of `main` and then thrown away, because `process.exit(1)` ran before
// `report(...)`. That is the run whose output gets pasted into an incident.
//
// The socket here is a FIXTURE: every query in `schema-check.ts` is a static
// tagged template with no interpolation, so answering on the query text
// exercises the real control flow without a database.

interface CompositeFk {
  name: string;
  child: string;
  fk_cols: string[];
  set_cols: string[];
}

interface Catalogues {
  /** Tables to OMIT a column from, as table -> the columns the database lacks. */
  missingColumns?: Record<string, string[]>;
  indexNames?: Set<string>;
  constraintNames?: Set<string>;
  functionNames?: Set<string>;
  /** The composite ON DELETE SET NULL foreign keys this database holds. */
  compositeFks?: CompositeFk[];
  /** Orphaned rows this database holds, as table -> row count. */
  orphanRows?: Record<string, number>;
  /** Organizations this connection can SEE. Default: some. */
  organizationsVisible?: number;
  /** Make the orphan reads throw, as a table this connection cannot select from. */
  orphanReadFails?: string;
  /** The visibility guard answers NO ROW at all. */
  organizationsReturnsNoRow?: boolean;
  /** The visibility guard answers something that is not a count (int8 as text). */
  organizationsRawRows?: unknown;
}

/** One narrowed FK, as 0052 leaves it: one column, its own, never org_id. */
const NARROWED: CompositeFk = {
  name: 'boqs_engagement_same_org_fk',
  child: 'boqs',
  fk_cols: ['org_id', 'engagement_id'],
  set_cols: ['engagement_id'],
};

/**
 * A correctly narrowed database: one row per composite set-null FK `src/schema/`
 * declares. TWELVE — as production holds after 0052, and as the schema declares
 * since `files.ts` picked up `files_category_same_org_fk` (wave 8 item 1). It was
 * eleven declared plus that one appended by hand here, which is exactly the gap
 * that commit closed; the append is gone because the schema now carries it.
 * Derived, so the L3 floor is satisfied by this fixture for the same reason it is
 * satisfied by a real database.
 */
function narrowedCatalogue(): CompositeFk[] {
  return [...declaredCompositeSetNullFks()].map(([name, fk]) => ({
    name,
    child: fk.table,
    fk_cols: ['org_id', ...fk.columns],
    set_cols: [...fk.columns],
  }));
}

/** A postgres.js stand-in that answers the four catalogue reads from fixtures. */
function fixtureSql(catalogues: Catalogues): CatalogueSql {
  const declared = declaredTables();
  const absent = catalogues.missingColumns ?? {};
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('confdeltype')) {
      return Promise.resolve(catalogues.compositeFks ?? narrowedCatalogue());
    }
    if (text.includes('information_schema.columns')) {
      const rows: Array<{ table_name: string; column_name: string }> = [];
      for (const [table, columns] of declared) {
        for (const column of columns) {
          if (absent[table]?.includes(column)) continue;
          rows.push({ table_name: table, column_name: column });
        }
      }
      return Promise.resolve(rows);
    }
    const names = text.includes('pg_indexes')
      ? catalogues.indexNames
      : text.includes('pg_constraint')
        ? catalogues.constraintNames
        : catalogues.functionNames;
    return Promise.resolve([...(names ?? [])].map((name) => ({ name })));
  };
  // `.unsafe`, for the one section that reads USER ROWS rather than a catalogue.
  // It answers on the query text like the tagged templates do, so the real
  // control flow — the organizations guard first, then the per-table counts — is
  // the flow under test.
  const unsafe = (query: string) => {
    if (catalogues.orphanReadFails !== undefined) {
      return Promise.reject(
        new Error(`permission denied for table ${catalogues.orphanReadFails}`),
      );
    }
    if (query === ORGANIZATIONS_VISIBLE_QUERY) {
      if (catalogues.organizationsReturnsNoRow === true) return Promise.resolve([]);
      if (catalogues.organizationsRawRows !== undefined) {
        return Promise.resolve([{ rows: catalogues.organizationsRawRows }]);
      }
      return Promise.resolve([{ rows: catalogues.organizationsVisible ?? 7 }]);
    }
    const orphans = catalogues.orphanRows ?? {};
    return Promise.resolve(
      orgScopedTableNames().map((table) => ({ table_name: table, rows: orphans[table] ?? 0 })),
    );
  };
  return Object.assign(sql, { unsafe }) as unknown as CatalogueSql;
}

/** Every catalogue complete, so only the case's own gap can be reported. */
function completeCatalogues(missing?: Record<string, string[]>): Catalogues {
  return {
    missingColumns: missing,
    indexNames: new Set(),
    constraintNames: new Set(),
    functionNames: new Set(),
  };
}

const logged: string[] = [];
const errored: string[] = [];
function captureConsole() {
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logged.push(parts.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    errored.push(parts.map(String).join(' '));
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  logged.length = 0;
  errored.length = 0;
});

/** The four section headings, in the order the owner is told to paste them. */
function sectionsPrinted(): string[] {
  return [...logged, ...errored]
    .flatMap((line) => line.split('\n'))
    .filter((line) => /^assert-schema-applied: (OK|indexes|constraints|functions)/.test(line))
    .concat(
      errored.some((line) => line.includes('this database is BEHIND the code'))
        ? ['columns: BEHIND']
        : [],
    );
}

describe('runSchemaCheck', () => {
  it('prints all four sections and exits 0 when the database is current', async () => {
    captureConsole();
    // The name gaps are deliberately EVERY declared name: the three report-only
    // sections must not move the exit code however loud they are.
    const code = await runSchemaCheck(fixtureSql(completeCatalogues()));
    expect(code).toBe(0);
    expect(sectionsPrinted()).toHaveLength(4);
    expect(logged.join('\n')).toContain('every column present');
  });

  it('ONE missing column: four sections printed, exit 1', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql(completeCatalogues({ boqs: ['total'] })),
    );

    // The gate.
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain('this database is BEHIND the code');
    expect(errored.join('\n')).toContain('- boqs: total');

    // The defect: these three were computed and discarded.
    const printed = logged.join('\n');
    expect(printed).toMatch(/indexes — \d+ declared/);
    expect(printed).toMatch(/constraints — \d+ declared/);
    expect(printed).toMatch(/functions — \d+ declared/);
    expect(sectionsPrinted()).toEqual([
      'assert-schema-applied: indexes — 105 declared, 105 NOT FOUND (report only, does not fail this check):',
      'assert-schema-applied: constraints — 219 declared, 219 NOT FOUND (report only, does not fail this check):',
      'assert-schema-applied: functions — 30 declared, 30 NOT FOUND (report only, does not fail this check):',
      'columns: BEHIND',
    ]);
    expect(printed).toContain('REPORT ONLY');
  });

  it('a report-only gap alone never moves the exit code', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), functionNames: new Set(['app_nothing']) }),
    );
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain('functions — 30 declared, 30 NOT FOUND');
  });
});

describe('the counts the deploy order asks the owner to compare', () => {
  it('declares 30 RLS functions, not 29', () => {
    // wave6-coder.md's handoff said 29 and instructed the lead to compare the
    // printed counts against it. A `create or replace function public.<name>`
    // grep over rls/ returns 30 with no duplicate name, so the handoff number
    // was one short. Pinned here so the next handoff copies a tested fact.
    expect(declaredFunctions().size).toBe(30);
  });
});

describe('composite set-null foreign keys are a GATE, not a report (R6)', () => {
  // `assert-schema-applied` compares `conname` and a narrowing changes no name,
  // so before wave 7 step 3 of the deploy printed `constraints — 218 declared,
  // 0 NOT FOUND` over a catalogue where every composite SET NULL still nulled
  // org_id on a parent delete. Nothing on PRODUCTION asserted 0052 had done
  // anything; only a CI dbtest against a fresh database did.
  it('passes, and says so, when every one is narrowed', async () => {
    captureConsole();
    const code = await runSchemaCheck(fixtureSql(completeCatalogues()));
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain(
      'composite set-null FKs — 12 found (12 declared in src/schema/), every one narrowed',
    );
  });

  it('FAILS on one that nulls every referencing column — the pre-0052 shape', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({
        ...completeCatalogues(),
        compositeFks: [
          ...narrowedCatalogue(),
          {
            name: 'files_category_same_org_fk',
            child: 'files',
            fk_cols: ['org_id', 'category_id'],
            set_cols: [],
          },
        ],
      }),
    );
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain(
      'files_category_same_org_fk (on files) nulls EVERY referencing column, org_id included',
    );
  });

  it('FAILS on one narrowed onto org_id, which would strip the tenant', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({
        ...completeCatalogues(),
        compositeFks: [...narrowedCatalogue(), { ...NARROWED, set_cols: ['org_id'] }],
      }),
    );
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain('nulls org_id, which would strip the row of its tenant');
  });

  it('FAILS on a hand-applied narrowing onto the WRONG column (S3)', async () => {
    // 0052's idempotency branch counts any existing column list as "already
    // narrow" without comparing it, so this shape survives a re-run of the
    // migration and is invisible to every name comparison.
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({
        ...completeCatalogues(),
        compositeFks: [...narrowedCatalogue(), { ...NARROWED, set_cols: ['client_id'] }],
      }),
    );
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain(
      'nulls client_id, which is not one of its own referencing columns (engagement_id)',
    );
  });

  it('FAILS on one that nulls more than one column', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({
        ...completeCatalogues(),
        compositeFks: [...narrowedCatalogue(), { ...NARROWED, set_cols: ['engagement_id', 'org_id'] }],
      }),
    );
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain('a narrowed FK nulls exactly one column');
  });
});

describe('the orphaned-org-rows section (wave 8 item 4)', () => {
  // The same post-condition `db:purge-fixture-orgs` throws on, asked here of
  // whatever database the owner is pointing at. REPORT ONLY: an orphan is a data
  // incident on an existing database, not a reason for this script to refuse to
  // print the four sections it exists for.
  it('says so, by name, when every org-scoped table is clean', async () => {
    captureConsole();
    const code = await runSchemaCheck(fixtureSql(completeCatalogues()));
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain(
      `orphaned org rows — ${String(orgScopedTableNames().length)} org-scoped table(s) ` +
        'answered, none holds a row whose org_id names no organization.',
    );
  });

  it('names the table and the count, and does NOT move the exit code', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), orphanRows: { boq_lines: 3, files: 1 } }),
    );
    expect(code).toBe(0);
    const printed = logged.join('\n');
    expect(printed).toContain('2 WITH ORPHANS (report only, does not fail this check)');
    expect(printed).toContain('- boq_lines: 3 row(s) whose org_id names no organization');
    expect(printed).toContain('- files: 1 row(s) whose org_id names no organization');
    // The one sentence that tells the reader where this can come from at all.
    expect(printed).toContain("session_replication_role = 'replica'");
  });

  it('refuses to report at all when it cannot see organizations', async () => {
    // Without this guard, a connection subject to RLS reads no organizations,
    // `org_id not in ()` is true for every row, and all 44 tables report fully
    // orphaned. A false ALARM pointing at 44 innocent tables.
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), organizationsVisible: 0 }),
    );
    expect(code).toBe(0);
    const printed = logged.join('\n');
    // Its OWN sentence: no table count, no "WITH ORPHANS", no remediation
    // paragraph. It is a connection problem, not a data incident (F2).
    expect(printed).toContain(
      'orphaned org rows — could not be read: this connection reads 0 rows from ' +
        'public.organizations, so every table would report fully orphaned',
    );
    expect(printed).not.toContain('WITH ORPHANS');
    expect(printed).not.toContain('org-scoped table(s) answered');
    expect(printed).not.toContain('Find the rows by org_id');
  });

  it('a table it cannot read does not take the whole report down', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), orphanReadFails: 'boq_lines' }),
    );
    expect(code).toBe(0);
    const printed = logged.join('\n');
    expect(printed).toContain(
      'orphaned org rows — could not be read: permission denied for table boq_lines',
    );
    // A REJECTED read used to print "44 org-scoped table(s) read, 1 WITH ORPHANS"
    // and the remediation paragraph, over a count nothing had read (F2).
    expect(printed).not.toContain('WITH ORPHANS');
    expect(printed).not.toContain('org-scoped table(s) answered');
    expect(printed).not.toContain('Find the rows by org_id');
    // And the four sections the owner came for still printed.
    expect(sectionsPrinted()).toHaveLength(4);
  });

  it('an EMPTY visibility result is unavailable, not a crash (F2)', async () => {
    // `const [visible] = await …` over an empty result is `undefined`, and the
    // first version read `visible.rows` off it — `Cannot read properties of
    // undefined`, caught by the wrapper, and printed as "1 WITH ORPHANS".
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), organizationsReturnsNoRow: true }),
    );
    expect(code).toBe(0);
    const printed = logged.join('\n');
    expect(printed).toContain('orphaned org rows — could not be read:');
    expect(printed).toContain('returned no row at all');
    expect(printed).not.toContain('WITH ORPHANS');
  });

  it('counts organizations NUMERICALLY, so int8-as-a-string cannot pass (F7)', async () => {
    // `count(*)` is int8. A driver that hands it back as '0' makes a strict
    // `=== 0` guard dead: the guard passes, the orphan query then reports every
    // table fully orphaned, and the operator is pointed at 44 innocent tables.
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), organizationsRawRows: '0' }),
    );
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain(
      'this connection reads 0 rows from public.organizations',
    );
  });

  it('a non-count answer is unavailable rather than NaN (F7)', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), organizationsRawRows: null }),
    );
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain('which is not a count');
  });
});

describe('the floor under the composite set-null gate (L3)', () => {
  // Every other guard shipped this wave carries a guard on the guard. This one
  // did not: a fixture answering `[]` printed "0 found, every one narrowed" and
  // exited 0, so a schema edit that turned an `onDelete: 'set null'` into
  // anything else would drop the row out of the query and the count would fall
  // silently.
  it('FAILS when the database holds fewer than src/schema declares', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), compositeFks: [] }),
    );
    expect(code).toBe(1);
    expect(errored.join('\n')).toContain(
      `only 0 found and src/schema/ declares ${String(declaredCompositeSetNullFks().size)}`,
    );
  });

  it('derives the floor from the schema, and the schema declares TWELVE', () => {
    // Twelve since wave 8 item 1. It was eleven for one wave, and the twelfth —
    // `files_category_same_org_fk`, created by 0040 and declared by no schema
    // file — is the reason this gate existed with a floor BELOW what every
    // database actually held: a silent un-narrowing of that one would have been
    // invisible to the production-side check. Derived from `src/schema/`, so
    // deleting the declaration in `files.ts` reds this line and not a comment.
    const declared = declaredCompositeSetNullFks();
    expect(declared.size).toBe(12);
    expect(declared.get('boqs_engagement_same_org_fk')).toEqual({
      table: 'boqs',
      columns: ['engagement_id'],
    });
    expect(declared.get('files_category_same_org_fk')).toEqual({
      table: 'files',
      columns: ['category_id'],
    });
  });

  it('declares the twelfth WITHOUT asking for an index the database lacks', () => {
    // `sameOrgFk` ships an `(org_id, <x>_id)` index with every FK it emits. On
    // `files` that would be `files_category_idx`, which exists in no database and
    // would therefore turn a pure declaration into pending DDL — and would be
    // reported as missing by `assert-schema-applied` and by the migration
    // catalogue for ever. `index: false` is why neither happens.
    expect(declaredIndexes().has('files_category_idx')).toBe(false);
    expect(declaredIndexes().has('files_org_category_idx')).toBe(true);
  });

  it('passes on the twelve a narrowed database holds', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), compositeFks: narrowedCatalogue() }),
    );
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain('12 found (12 declared in src/schema/)');
  });
});
