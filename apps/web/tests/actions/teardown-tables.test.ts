import { describe, expect, it } from 'vitest';
import { orgScopedTableNames } from '../../../../packages/db/src/scripts/schema-catalogue';
import {
  TEARDOWN_ORDER,
  TEARDOWN_TABLES_DELETED_LAST,
  TEARDOWN_TABLES_IN_FK_ORDER,
} from './teardown-tables';

// THE LIST THAT ACTUALLY LOST THE BOQ TABLES, CHECKED WITHOUT A DATABASE.
//
// Wave 8's item 4 hardened `db:purge-fixture-orgs`'s delete list and found it
// had been complete all along. This is the list the 0041 miss really happened
// to: `boqs`, `boq_sections` and `boq_lines` were added to the schema and to
// nothing here, and a fixture teardown runs under
// `SET LOCAL session_replication_role = 'replica'`, where foreign keys are not
// enforced. A table missing from the list therefore does not raise — it leaves
// rows pointing at an organization the same transaction has just deleted, and
// every assertion in the suite still passes.
//
// It is complete today (43 tables plus the polymorphic `files`). Nothing until
// now made it stay that way.
//
// A NODE TEST, NOT A DBTEST, and that is the whole point: `fixture.ts` opens a
// postgres connection at module load, so the list could never be imported to be
// checked. It lives in `teardown-tables.ts` now, which imports nothing, and this
// file runs in `npm run test -w @metra/web` — the suite that opens no connection
// and needs no DATABASE_URL.
//
// The cross-package relative import follows the precedent set in wave 7 by
// `lib/engagements/design-engagement-grants.test.ts`: no new package export
// subpath, no runtime dependency, nothing new in the Worker bundle.

describe('the fixture teardown covers every org-scoped table the schema declares', () => {
  it('finds the lists it is meant to be checking', () => {
    // A guard on the guard: two empty lists compare equal.
    expect(TEARDOWN_ORDER.length).toBeGreaterThan(40);
    expect(orgScopedTableNames().length).toBeGreaterThan(40);
  });

  it('is missing no org-scoped table', () => {
    const covered = new Set(TEARDOWN_ORDER);
    const missing = orgScopedTableNames().filter((table) => !covered.has(table));
    expect(
      missing,
      'A table with an org_id column is not in the fixture teardown. Add it to ' +
        'TEARDOWN_TABLES_IN_FK_ORDER BY HAND, child before parent — a teardown runs ' +
        "under `session_replication_role = 'replica'`, where a missing table does not " +
        'raise, it ORPHANS, and the suite still passes. This is exactly what happened ' +
        'to the BOQ tables at 0041.',
    ).toEqual([]);
  });

  it('carries nothing that is not an org-scoped table', () => {
    // A renamed or removed table leaves a name here that the teardown then fails
    // on with 42P01, mid-transaction, in a suite that has nothing to do with it.
    const declared = new Set(orgScopedTableNames());
    expect(TEARDOWN_ORDER.filter((table) => !declared.has(table))).toEqual([]);
  });

  it('names each table exactly once', () => {
    expect(new Set(TEARDOWN_ORDER).size).toBe(TEARDOWN_ORDER.length);
  });

  it('deletes the BOQ tree child-before-parent, and before clients/projects', () => {
    // The 0041 miss, pinned as the order it needs rather than only as presence:
    // boqs reference clients AND projects with RESTRICT.
    const at = (table: string) => TEARDOWN_ORDER.indexOf(table);
    for (const table of ['boq_lines', 'boq_sections', 'boqs']) {
      expect(at(table), `${table} is not in the teardown order`).toBeGreaterThanOrEqual(0);
    }
    expect(at('boq_lines')).toBeLessThan(at('boq_sections'));
    expect(at('boq_sections')).toBeLessThan(at('boqs'));
    expect(at('boqs')).toBeLessThan(at('clients'));
    expect(at('boqs')).toBeLessThan(at('projects'));
  });

  it('deletes the polymorphic files LAST', () => {
    // It is referenced from several trees, so it sits outside the ordered list
    // rather than somewhere in the middle of it.
    expect(TEARDOWN_TABLES_DELETED_LAST).toEqual(['files']);
    expect(TEARDOWN_ORDER[TEARDOWN_ORDER.length - 1]).toBe('files');
    expect(TEARDOWN_TABLES_IN_FK_ORDER).not.toContain('files');
  });
});
