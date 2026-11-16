import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_KEY_UPDATE_COLUMNS, CLIENT_CLAIM_UPDATE_COLUMNS } from './column-grant-sets';
import { grantedUpdateColumnsOf, tableLevelUpdateGrantsOf, updateRevokesOf } from './column-update-grant';

// The two tables security batch 3 (A5) narrowed to a column-level UPDATE, read
// with the same three readers as design_engagements (column-update-grant.test.ts).
// Their shape differs in one way that matters: the table level is taken away by
// `revoke all`, which spells no word "update" and revokes it anyway, so a reader
// that looked only for `revoke update` would report no revoke at all, and one
// appended BELOW the column grant (which wipes it) would go unseen.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const ROLES_SQL = resolve(here, '../rls/roles.sql');

function shipped(table: string, tableLevel: string, columns: string): string {
  return `
-- A comment that says: grant all on public.${table} to metra_app.
revoke all on public.${table} from metra_app;
grant ${tableLevel} on public.${table} to metra_app;
grant update (
  ${columns}
) on public.${table} to metra_app;
`;
}

const NARROWED = [
  {
    table: 'client_payment_claims',
    tableLevel: 'select',
    invariant: CLIENT_CLAIM_UPDATE_COLUMNS,
    otherTable: 'contract_payment_claims',
  },
  { table: 'api_keys', tableLevel: 'select, insert', invariant: API_KEY_UPDATE_COLUMNS, otherTable: 'client_payment_claims' },
];

describe.each(NARROWED)('$table: the revoke-all, grant, column-grant shape', ({ table, tableLevel, invariant, otherTable }) => {
  const fixture = shipped(table, tableLevel, 'status,\n  updated_at');

  it('reads the column list of this table, and refuses a file that has none for it', () => {
    expect(grantedUpdateColumnsOf(fixture, table)).toEqual(['status', 'updated_at']);
    expect(() => grantedUpdateColumnsOf(shipped(otherTable, 'select', 'status'), table)).toThrow(
      `no \`grant update (…) on public.${table} to metra_app;\``,
    );
  });

  it('counts `revoke all` as the revoke that belongs, comment included, and finds no re-widening', () => {
    expect(updateRevokesOf(fixture, table)).toEqual({ before: [`revoke all on public.${table} from metra_app;`], after: [] });
    expect(tableLevelUpdateGrantsOf(fixture, table)).toEqual([]);
  });

  it('catches a revoke appended below the column grant, in every spelling that takes UPDATE away', () => {
    for (const privileges of ['all', 'all privileges', 'update', 'insert, update']) {
      const tidied = `${fixture}revoke ${privileges} on public.${table} from metra_app;`;
      expect(updateRevokesOf(tidied, table).after, privileges).toEqual([`revoke ${privileges} on public.${table} from metra_app;`]);
    }
    expect(updateRevokesOf(`${fixture}revoke delete on public.${table} from metra_app;`, table).after).toEqual([]);
  });

  it('does not count a revoke on another table, before or after', () => {
    const others = `revoke all on public.${otherTable} from metra_app;\n`;
    expect(updateRevokesOf(`${others}${fixture}${others}`, table)).toEqual({
      before: [`revoke all on public.${table} from metra_app;`],
      after: [],
    });
  });

  it('catches a table-level UPDATE granted back, in the spellings the old grant used', () => {
    for (const statement of [
      `grant select, insert, update on public.${table} to metra_app;`,
      `grant all on public.${table} to metra_app;`,
      `grant update on public.${table} to public;`,
    ]) {
      expect(tableLevelUpdateGrantsOf(fixture + statement, table), statement).toHaveLength(1);
    }
    expect(tableLevelUpdateGrantsOf(`${fixture}grant select, insert, update on public.${otherTable} to metra_app;`, table)).toEqual([]);
  });

  it('the file as shipped grants exactly the invariant columns, revokes first, and re-widens nowhere', () => {
    const roles = readFileSync(ROLES_SQL, 'utf8');
    expect(new Set(grantedUpdateColumnsOf(roles, table))).toEqual(invariant);
    expect(grantedUpdateColumnsOf(roles, table)).toHaveLength(invariant.size);
    expect(updateRevokesOf(roles, table)).toEqual({ before: [`revoke all on public.${table} from metra_app;`], after: [] });
    expect(tableLevelUpdateGrantsOf(roles, table)).toEqual([]);
  });
});
