import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  grantedUpdateColumns,
  tableLevelUpdateGrants,
  updateRevokes,
} from './design-engagement-grant';

// The three readings of roles.sql that the app-side drift test and the
// database-side `verify-rls-applied` both depend on. Each case here is a
// mutation a wave-7 tester actually walked past, written as a fixture so the
// walk-past cannot come back:
//
//   S1  `grant all on public.design_engagements to metra_app;` confers
//       table-level UPDATE and contains no word "update". The guard it defeated
//       required that word between `grant` and `on`.
//   S2  a SECOND `revoke update`, appended BELOW the column grant, wipes all
//       fifteen column privileges (PostgreSQL revokes column privileges with the
//       table privilege). The guard it defeated looked at the first match only.
//
// The real file is read at the bottom, so these fixtures cannot drift away from
// the thing they describe.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const ROLES_SQL = resolve(here, '../rls/roles.sql');

const SHIPPED = `
-- A comment that says: grant all on public.design_engagements to metra_app.
grant select, insert on public.design_engagements to metra_app;
revoke update on public.design_engagements from metra_app;
grant update (
  state,
  design_fee
) on public.design_engagements to metra_app;
`;

describe('grantedUpdateColumns', () => {
  it('reads the column list, and refuses a file with no column grant', () => {
    expect(grantedUpdateColumns(SHIPPED)).toEqual(['state', 'design_fee']);
    expect(() => grantedUpdateColumns('grant select on public.boqs to metra_app;')).toThrow(
      'no `grant update',
    );
  });
});

describe('tableLevelUpdateGrants', () => {
  it('is empty for the shipped shape, COMMENT INCLUDED', () => {
    // The comment above the statements names the exact re-widening this refuses.
    // Prose must not be able to fail the gate — nor to satisfy one.
    expect(tableLevelUpdateGrants(SHIPPED)).toEqual([]);
  });

  it('catches every spelling of a re-widening', () => {
    const widened = [
      'grant all on public.design_engagements to metra_app;',
      'grant all privileges on public.design_engagements to metra_app;',
      'grant select, insert, update, delete on public.design_engagements to metra_app;',
      'GRANT UPDATE ON PUBLIC.DESIGN_ENGAGEMENTS TO METRA_APP;',
      'grant update\n  on public.design_engagements\n  to metra_app;',
      'grant update on public.design_engagements to metra_app with grant option;',
      // M1 — the spellings the first version of this guard walked straight past.
      'grant all on table public.design_engagements to metra_app;',
      'grant all privileges on table design_engagements to metra_app;',
      'grant all on all tables in schema public to metra_app;',
      'grant update on public."design_engagements" to metra_app;',
      'grant update on "public"."design_engagements" to metra_app;',
      'grant update on design_engagements to metra_app;',
      // PUBLIC is every role, metra_app included.
      'grant all on public.design_engagements to public;',
    ];
    for (const statement of widened) {
      expect(tableLevelUpdateGrants(SHIPPED + statement)).toHaveLength(1);
    }
  });

  it('leaves the column form, and other tables and roles, alone', () => {
    const narrow = [
      // A column list is a column list however it is spelled.
      'grant update (state) on table public.design_engagements to metra_app;',
      'grant all (state) on public.design_engagements to metra_app;',
      // Another table, and another role.
      'grant select, insert, update, delete on public.boqs to metra_app;',
      'grant all on all tables in schema public to some_reporting_role;',
      'grant all on public.design_engagements to some_reporting_role;',
      // Not a privilege grant at all.
      'grant metra_app to postgres;',
    ];
    for (const statement of narrow) {
      expect(tableLevelUpdateGrants(SHIPPED + statement)).toEqual([]);
    }
  });

  it('does not mistake a grant on ANOTHER table for one on this one', () => {
    expect(
      tableLevelUpdateGrants(
        `${SHIPPED}grant select, insert, update, delete on public.boqs to metra_app;`,
      ),
    ).toEqual([]);
  });
});

describe('updateRevokes', () => {
  it('reports the revoke that belongs, and none after the grant', () => {
    expect(updateRevokes(SHIPPED)).toEqual({
      before: ['revoke update on public.design_engagements from metra_app;'],
      after: [],
    });
  });

  it('catches a SECOND revoke appended below the grant', () => {
    const tidied = `${SHIPPED}revoke update on public.design_engagements from metra_app;`;
    expect(updateRevokes(tidied).after).toEqual([
      'revoke update on public.design_engagements from metra_app;',
    ]);
  });
});

describe('the file as shipped', () => {
  it('grants fifteen columns, revokes the table level first, and re-widens nowhere', () => {
    const text = readFileSync(ROLES_SQL, 'utf8');
    expect(grantedUpdateColumns(text)).toHaveLength(15);
    expect(tableLevelUpdateGrants(text)).toEqual([]);
    expect(updateRevokes(text)).toEqual({
      before: ['revoke update on public.design_engagements from metra_app;'],
      after: [],
    });
  });
});
