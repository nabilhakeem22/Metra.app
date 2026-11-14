import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { appQuery, closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';
import { failuresOf, freshHash, record, removePlanted } from './sign-in-failures-fixture';

// Security batch 3, P2: who may reach sign_in_failures and its two functions
// (nobody but the connection role), and how long a record waits for its row.
// The counting rule itself is sign-in-failures.dbtest.ts.

afterEach(removePlanted);

afterAll(async () => {
  await closeExecutionFixture();
});

describe('nobody but the connection role reaches the table or the functions (AC16)', () => {
  const FUNCTIONS = ['public.app_sign_in_pause_seconds(text)', 'public.app_sign_in_failure_record(text)'];

  it('metra_app, and the API roles where they exist, hold no table privilege and no EXECUTE', async () => {
    const rows = await ownerQuery<{ role: string; privilege: string; held: boolean }>(
      `select r.rolname as role, p.name as privilege,
              case when p.name = 'execute'
                then has_function_privilege(r.oid, $1::regprocedure, 'execute') or has_function_privilege(r.oid, $2::regprocedure, 'execute')
                else has_table_privilege(r.oid, 'public.sign_in_failures'::regclass, p.name) end as held
         from pg_roles r
        cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'execute']) as p(name)
        where r.rolname in ('metra_app', 'anon', 'authenticated')`,
      FUNCTIONS,
    );
    expect(rows.filter((row) => row.role === 'metra_app')).toHaveLength(6);
    expect(rows.filter((row) => row.held)).toEqual([]);
  });

  it('both are definers with an empty search_path, closed to PUBLIC, and the table is forced behind a refuse-all policy', async () => {
    const functions = await ownerQuery<{ name: string; definer: boolean; config: string[]; public_grants: number }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public_grants
         from pg_proc p where p.oid in ($1::regprocedure, $2::regprocedure) order by 1`,
      FUNCTIONS,
    );
    expect(functions.map((row) => ({ ...row, config: [...row.config].sort() }))).toEqual([
      { name: 'app_sign_in_failure_record', definer: true, config: ['lock_timeout=2s', 'search_path=""'], public_grants: 0 },
      { name: 'app_sign_in_pause_seconds', definer: true, config: ['search_path=""'], public_grants: 0 },
    ]);
    const [table] = await ownerQuery<{ enabled: boolean; forced: boolean; policies: string[] }>(
      `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
              (select array_agg(format('%s using %s check %s', pol.policyname, pol.qual, pol.with_check))
                 from pg_policies pol where pol.schemaname = 'public' and pol.tablename = 'sign_in_failures') as policies
         from pg_class c where c.oid = 'public.sign_in_failures'::regclass`,
    );
    expect(table).toEqual({ enabled: true, forced: true, policies: ['no_direct_access using false check false'] });
  });

  it('metra_app gets 42501 from both functions and from the table', async () => {
    const hash = freshHash();
    const asApp = (text: string) => sqlstate(appQuery(randomUUID(), randomUUID(), text, [hash]));
    expect(await asApp(`select public.app_sign_in_pause_seconds($1)`)).toBe('42501');
    expect(await asApp(`select public.app_sign_in_failure_record($1)`)).toBe('42501');
    expect(await asApp(`select 1 from public.sign_in_failures where identifier_hash = $1`)).toBe('42501');
    expect(await failuresOf(hash)).toBeUndefined();
  });
});

describe('a record that cannot take its row gives up in about 2 s', () => {
  it('fails with 55P03 while another transaction holds the row, and counts once it is free', async () => {
    const hash = freshHash();
    expect(await record(hash)).toBeNull();
    const holder = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
    try {
      await holder.begin(async (tx) => {
        await tx`select 1 from public.sign_in_failures where identifier_hash = ${hash} for update`;
        const started = Date.now();
        expect(await sqlstate(record(hash))).toBe('55P03');
        expect(Date.now() - started).toBeLessThan(10_000);
      });
    } finally {
      await holder.end();
    }
    expect(await record(hash)).toBeNull();
    expect(await failuresOf(hash)).toBe(2);
  });
});
