import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiKeys, clientPaymentClaims } from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_UPDATE_COLUMNS,
  CLIENT_CLAIM_UPDATE_COLUMNS,
} from '../../../../../packages/db/src/scripts/column-grant-sets';
import {
  grantedUpdateColumnsOf,
  tableLevelUpdateGrantsOf,
  updateRevokesOf,
} from '../../../../../packages/db/src/scripts/column-update-grant';
import { updateWriteSites } from '@/test/column-writes/write-sites';
import { columnWriteTarget } from '@/test/column-writes/write-target';

// THE TWO GRANTS SECURITY BATCH 3 NARROWED (A5), AGAINST THE CODE.
//
// `rls/roles.sql` grants metra_app a COLUMN-LEVEL update on `api_keys` (the
// revoke's two columns: a key resolves through its creator's live role, so
// `created_by` must never move) and on `client_payment_claims` (the studio's
// answer, never what the client claimed). Each list is checked three ways and
// this file is the first: it DERIVES the written columns from every update
// site in `apps/web/src` and `packages/db/src` (the scan in
// `src/test/column-writes/`, the one `design_engagements` is checked with) and
// compares them with the grant, with no database, before the grant is applied.
// Add a column to a `.set({…})` on either table without granting it and this
// goes red here, instead of becoming a 42501 in production. The other two are
// the invariant lists in `packages/db/src/scripts/column-grant-sets.ts` and the
// database read-back `apply-rls` runs against them.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/db
const ROLES_SQL = resolve(here, '../../../../../packages/db/src/rls/roles.sql');

const NARROWED = [
  { table: 'api_keys', target: columnWriteTarget('apiKeys', apiKeys), invariant: API_KEY_UPDATE_COLUMNS },
  {
    table: 'client_payment_claims',
    target: columnWriteTarget('clientPaymentClaims', clientPaymentClaims),
    invariant: CLIENT_CLAIM_UPDATE_COLUMNS,
  },
];

describe.each(NARROWED)('$table column grants match what the app writes', ({ table, target, invariant }) => {
  const sites = updateWriteSites(target);
  const rolesSql = readFileSync(ROLES_SQL, 'utf8');

  it('finds the update sites it is meant to be checking', () => {
    // A guard on the guard: a renamed table export or a moved source root would
    // otherwise make every assertion below pass vacuously.
    expect(target.tableSqlName).toBe(table);
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it('grants exactly the columns the update sites write: no more, no fewer', () => {
    const written = new Set(sites.flatMap((site) => site.columns));
    const granted = new Set(grantedUpdateColumnsOf(rolesSql, table));
    const missing = [...written].filter((column) => !granted.has(column)).sort();
    const surplus = [...granted].filter((column) => !written.has(column)).sort();

    // Two named lists rather than a set comparison: which DIRECTION it drifted
    // is the whole diagnosis. `missing` is a 42501 waiting to happen; `surplus`
    // is authority nothing uses.
    expect({ missing, surplus }).toEqual({ missing: [], surplus: [] });
  });

  it('grants exactly the invariant list the database read-back checks', () => {
    expect([...grantedUpdateColumnsOf(rolesSql, table)].sort()).toEqual([...invariant].sort());
  });

  it('keeps every table-level privilege revoked BEFORE the column grant, so the list is not cosmetic', () => {
    // A table-level UPDATE subsumes every column grant; a revoke placed after
    // the column grant takes the column grant with it.
    expect(tableLevelUpdateGrantsOf(rolesSql, table)).toEqual([]);
    expect(updateRevokesOf(rolesSql, table)).toEqual({ before: [`revoke all on public.${table} from metra_app;`], after: [] });
  });

  it('never grants a column the schema does not have', () => {
    const columns = [...target.columnOf.values()];
    expect(grantedUpdateColumnsOf(rolesSql, table).filter((column) => !columns.includes(column))).toEqual([]);
  });
});
