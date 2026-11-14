// sign_in_failures isolation (security batch 3, P2; migration 0067). The table
// counts wrong sign-in codes per identifier hash BEFORE any session or org
// exists, so it carries NO org_id and the org_id auto-gate in
// cross-tenant.test.ts cannot cover it. This is its entry in the gate:
//   * it has FORCE row-level security and exactly one policy, which refuses;
//   * a REAL member, in their own org context as metra_app, is refused the
//     table outright (42501) on every statement, and its two functions too;
//   * so no tenant can read which identifiers failed sign-in, or pause one.
// Requires: migrations applied, RLS applied, seed run.
import { randomBytes } from 'node:crypto';
import { ORG_A_ID, USER_A_ID, createDb, withOrgContext, type MetraDb, type OrgContext } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;

let db: MetraDb;
let pg: ReturnType<typeof createDb>['sql'];

const memberOfOrgA: OrgContext = { orgId: ORG_A_ID, userId: USER_A_ID, role: 'owner' };
const plantedHash = randomBytes(32).toString('hex');
const forgedHash = randomBytes(32).toString('hex');

/** The SQLSTATE a statement is refused with as a real member of org A, or 'ran'. */
async function refusalAsMember(statement: string): Promise<string | undefined> {
  return withOrgContext(db, memberOfOrgA, (tx) => tx.execute(sql.raw(statement))).then(() => 'ran', sqlstateOf);
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const created = createDb(DATABASE_URL, { max: 1, prepare: true });
  db = created.db;
  pg = created.sql;
  await pg`insert into public.sign_in_failures (identifier_hash, failures) values (${plantedHash}, 10)`;
});

afterAll(async () => {
  if (!pg) return;
  await pg`delete from public.sign_in_failures where identifier_hash in (${plantedHash}, ${forgedHash})`;
  await pg.end();
});

describe('sign_in_failures is closed to every tenant', () => {
  it('has FORCE row-level security and one policy, which refuses every row', async () => {
    const [table] = await pg<{ rls: boolean; forced: boolean }[]>`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c where c.oid = 'public.sign_in_failures'::regclass
    `;
    expect(table).toEqual({ rls: true, forced: true });
    const policies = await pg<{ policyname: string; qual: string; with_check: string }[]>`
      select policyname, qual, with_check from pg_policies
       where schemaname = 'public' and tablename = 'sign_in_failures'
    `;
    expect([...policies]).toEqual([{ policyname: 'no_direct_access', qual: 'false', with_check: 'false' }]);
  });

  it('refuses a real member every statement on the table with 42501', async () => {
    expect(await refusalAsMember(`select identifier_hash from public.sign_in_failures`)).toBe('42501');
    expect(
      await refusalAsMember(`insert into public.sign_in_failures (identifier_hash, failures) values ('${forgedHash}', 10)`),
    ).toBe('42501');
    expect(await refusalAsMember(`update public.sign_in_failures set failures = 1`)).toBe('42501');
    expect(await refusalAsMember(`delete from public.sign_in_failures`)).toBe('42501');
  });

  it('refuses a real member both functions with 42501, so no tenant can pause an identifier', async () => {
    expect(await refusalAsMember(`select public.app_sign_in_pause_seconds('${plantedHash}')`)).toBe('42501');
    expect(await refusalAsMember(`select public.app_sign_in_failure_record('${forgedHash}')`)).toBe('42501');
  });

  it('left the planted row as it was and wrote no other', async () => {
    const rows = await pg<{ identifier_hash: string; failures: number }[]>`
      select identifier_hash, failures from public.sign_in_failures
       where identifier_hash in (${plantedHash}, ${forgedHash})
    `;
    expect([...rows]).toEqual([{ identifier_hash: plantedHash, failures: 10 }]);
  });
});
