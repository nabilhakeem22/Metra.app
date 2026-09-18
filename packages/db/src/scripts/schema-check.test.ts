import { afterEach, describe, expect, it, vi } from 'vitest';
import { declaredFunctions } from './rls-catalogue';
import { declaredCompositeSetNullFks, declaredTables } from './schema-catalogue';
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
 * declares, plus `files_category_same_org_fk`, which 0040 created and no schema
 * file declares. Twelve, as production will hold after 0052 — and derived, so the
 * floor added in L3 is satisfied by the fixture for the same reason it is
 * satisfied by a real database.
 */
function narrowedCatalogue(): CompositeFk[] {
  const rows = [...declaredCompositeSetNullFks()].map(([name, child]) => ({
    name,
    child,
    fk_cols: ['org_id', `${name}_col`],
    set_cols: [`${name}_col`],
  }));
  return [
    ...rows,
    {
      name: 'files_category_same_org_fk',
      child: 'files',
      fk_cols: ['org_id', 'category_id'],
      set_cols: ['category_id'],
    },
  ];
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
  return sql as unknown as CatalogueSql;
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
      'assert-schema-applied: indexes — 111 declared, 111 NOT FOUND (report only, does not fail this check):',
      'assert-schema-applied: constraints — 218 declared, 218 NOT FOUND (report only, does not fail this check):',
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
      'composite set-null FKs — 12 found (11 declared in src/schema/), every one narrowed',
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

  it('derives the floor from the schema, and the schema declares eleven', () => {
    // Eleven, not twelve: the database also holds `files_category_same_org_fk`,
    // which 0040 created and `files.ts` declares nowhere. That is why this is a
    // FLOOR and not an equality.
    const declared = declaredCompositeSetNullFks();
    expect(declared.size).toBe(11);
    expect(declared.get('boqs_engagement_same_org_fk')).toBe('boqs');
    expect(declared.has('files_category_same_org_fk')).toBe(false);
  });

  it('passes on the twelve a narrowed database holds', async () => {
    captureConsole();
    const code = await runSchemaCheck(
      fixtureSql({ ...completeCatalogues(), compositeFks: narrowedCatalogue() }),
    );
    expect(code).toBe(0);
    expect(logged.join('\n')).toContain('12 found (11 declared in src/schema/)');
  });
});
