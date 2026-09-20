import { describe, expect, it } from 'vitest';
import {
  ORGANIZATIONS_VISIBLE_QUERY,
  orphanOrgRowsQuery,
  orphanReportLines,
  orphanedTables,
} from './org-orphan-rows';
import {
  DELETE_ORDER,
  REMAINING_TABLES,
  TRIGGER_GUARDED_TABLES,
} from './purge-fixture-orgs-tables';
import { orgScopedTableNames } from './schema-catalogue';

// THE PURGE'S DELETE LIST, CHECKED WITHOUT A DATABASE.
//
// `assertDeleteOrderCoversEveryOrgScopedTable` has always compared the list
// against the live CATALOG — which is the right check and the wrong moment: it
// runs when somebody is already holding a connection to a database they are about
// to delete rows from. The drizzle schema answers the same question on a fresh
// clone, in milliseconds, so a new org-scoped table reds here the moment it is
// DECLARED rather than the next time anyone runs a purge.
//
// It matters because of exactly what the purge does: `set local
// session_replication_role = 'replica'` suspends the immutability triggers so
// frozen proposal/contract/variation rows can be deleted, and it suspends FOREIGN
// KEY enforcement with them. Inside that window a table missing from the list does
// not raise — it orphans. The fixture's own teardown list lost the BOQ tables
// exactly that way when 0041 landed.
//
// WHAT IS NOT DERIVED, AND WHY. The ORDER. It is foreign-key-driven and
// child-before-parent, and nothing in the schema knows which of two tables has to
// go first in the presence of the RESTRICT edges, the self-referential
// `supersedes_event_id`, and `organizations.logo_file_id` pointing the other way.
// So `DELETE_ORDER` stays written out by hand and this file proves it is COMPLETE
// and carries nothing surplus. A wrong order is proved by running the purge, where
// it raises a foreign-key violation outside the replica-mode window.

describe('DELETE_ORDER covers exactly the org-scoped tables src/schema/ declares', () => {
  it('finds the lists it is meant to be checking', () => {
    // A guard on the guard: two empty lists compare equal.
    expect(DELETE_ORDER.length).toBeGreaterThan(40);
    expect(orgScopedTableNames().length).toBeGreaterThan(40);
  });

  it('is missing no org-scoped table', () => {
    const covered = new Set(DELETE_ORDER);
    const missing = orgScopedTableNames().filter((table) => !covered.has(table));
    expect(
      missing,
      'A table with an org_id column is not in DELETE_ORDER. Add it to ' +
        'TRIGGER_GUARDED_TABLES or REMAINING_TABLES BY HAND, child before parent — ' +
        'inside the purge\'s replica-mode window a missing table orphans rows instead ' +
        'of raising, and every count in the run still reads as success.',
    ).toEqual([]);
  });

  it('carries nothing that is not an org-scoped table', () => {
    // The other direction, which the live-catalog check cannot report: a table
    // that was renamed or removed leaves a name here that the purge would then
    // fail on with 42P01, mid-run, after committing earlier chunks.
    const declared = new Set(orgScopedTableNames());
    expect(DELETE_ORDER.filter((table) => !declared.has(table))).toEqual([]);
  });

  it('names each table exactly once across the two halves', () => {
    // A table in BOTH halves would be deleted twice — the second time outside the
    // replica window, where its immutability trigger is live again.
    expect(new Set(DELETE_ORDER).size).toBe(DELETE_ORDER.length);
    expect(DELETE_ORDER).toEqual([...TRIGGER_GUARDED_TABLES, ...REMAINING_TABLES]);
  });

  it('covers the four the wave-8 brief asked about, in child-before-parent order', () => {
    // boqs / boq_sections / boq_lines / engagement_transitions were the named
    // suspects. They are all present — the list that lost them was the fixture's
    // teardown, not this one — and the order below is the property that matters.
    const at = (table: string) => DELETE_ORDER.indexOf(table);
    for (const table of ['boqs', 'boq_sections', 'boq_lines', 'engagement_transitions']) {
      expect(at(table), `${table} is not in DELETE_ORDER`).toBeGreaterThanOrEqual(0);
    }
    expect(at('boq_lines')).toBeLessThan(at('boq_sections'));
    expect(at('boq_sections')).toBeLessThan(at('boqs'));
    expect(at('engagement_transitions')).toBeLessThan(at('design_engagements'));
  });
});

describe('the orphan post-condition, as SQL text', () => {
  it('asks the organizations guard before it asks anything else', () => {
    expect(ORGANIZATIONS_VISIBLE_QUERY).toBe(
      'select count(*)::int as rows from public.organizations',
    );
  });

  it('counts every table the purge deletes from, each against organizations', () => {
    const query = orphanOrgRowsQuery(DELETE_ORDER);
    for (const table of DELETE_ORDER) {
      expect(query).toContain(
        `select '${table}' as table_name, count(*)::int as rows from public.${table} ` +
          'where org_id not in (select id from public.organizations)',
      );
    }
    expect(query.split('union all')).toHaveLength(DELETE_ORDER.length);
  });

  it('refuses a name that is not an org-scoped table of this schema', () => {
    // The interpolation below is the reason. It can only ever be reached by a name
    // the drizzle schema declares, so there is no caller-supplied identifier here
    // at all — and a table that was renamed fails LOUDLY rather than counting a
    // table that no longer exists.
    expect(() => orphanOrgRowsQuery(['organizations'])).toThrow(
      'is not an org-scoped table in src/schema/',
    );
    expect(() => orphanOrgRowsQuery(['boqs; drop table boqs'])).toThrow(
      'is not a bare lower-case identifier',
    );
    expect(() => orphanOrgRowsQuery(['Boqs'])).toThrow('is not a bare lower-case identifier');
  });

  it('refuses an EMPTY list rather than checking nothing and reporting OK', () => {
    expect(() => orphanOrgRowsQuery([])).toThrow('that would check nothing and report OK');
  });

  it('reports only the tables that actually hold an orphan', () => {
    const counts = [
      { table_name: 'boqs', rows: 0 },
      { table_name: 'boq_lines', rows: 3 },
      { table_name: 'files', rows: 0 },
    ];
    expect(orphanedTables(counts)).toEqual([{ table_name: 'boq_lines', rows: 3 }]);
    expect(orphanReportLines(counts)).toEqual([
      '  - boq_lines: 3 row(s) whose org_id names no organization',
    ]);
    expect(orphanReportLines(counts.filter((count) => count.rows === 0))).toEqual([]);
  });
});
