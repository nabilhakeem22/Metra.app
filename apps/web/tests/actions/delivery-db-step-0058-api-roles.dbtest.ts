import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw } from './fixture';

// Round C, PR-C7 fix round, defence in depth: after roles.sql, the Supabase API
// roles (anon, authenticated) hold NOTHING on any table or sequence in
// `public`, and objects the connection role creates later are not granted to
// them by default. Supabase grants both roles ALL on public by default; a plain
// Postgres has neither role, so this suite creates them, hands them the
// Supabase-style grants, re-applies roles.sql and reads the catalogue.

const ROLES_SQL = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../packages/db/src/rls/roles.sql');
const API_ROLES = ['anon', 'authenticated'];

afterAll(async () => {
  await raw.query('drop table if exists public.c7_default_acl_probe');
  await closeFixture();
});

/** Every ACL entry on a public table or sequence that names an API role. */
async function apiRoleGrants(): Promise<Array<{ relname: string; grantee: string; privilege: string }>> {
  return raw.query(
    `select c.relname, r.rolname as grantee, a.privilege_type as privilege
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join lateral aclexplode(c.relacl) a
       join pg_roles r on r.oid = a.grantee
      where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
        and r.rolname in ('anon', 'authenticated')`,
  );
}

/** The connection role's default privileges in public that name an API role. */
async function apiRoleDefaults(): Promise<Array<{ objtype: string; grantee: string }>> {
  return raw.query(
    `select d.defaclobjtype as objtype, r.rolname as grantee
       from pg_default_acl d
       join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
       cross join lateral aclexplode(d.defaclacl) a
       join pg_roles r on r.oid = a.grantee
      where d.defaclrole = (select oid from pg_roles where rolname = current_user)
        and r.rolname in ('anon', 'authenticated')`,
  );
}

describe('the API roles reach nothing in public (defence in depth)', () => {
  it('takes away Supabase-style table, sequence and default grants, and keeps them away', async () => {
    for (const role of API_ROLES) {
      await raw.query(
        `do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`,
      );
    }
    await raw.query(`create sequence if not exists public.c7_api_role_probe_seq`);
    await raw.query(`grant all on all tables in schema public to anon, authenticated`);
    await raw.query(`grant all on all sequences in schema public to anon, authenticated`);
    await raw.query(`alter default privileges in schema public grant all on tables to anon, authenticated`);
    await raw.query(`alter default privileges in schema public grant all on sequences to anon, authenticated`);
    expect((await apiRoleGrants()).length).toBeGreaterThan(40);
    expect((await apiRoleDefaults()).length).toBeGreaterThan(0);

    await raw.query(readFileSync(ROLES_SQL, 'utf8'));
    expect(await apiRoleGrants()).toEqual([]);
    expect(await apiRoleDefaults()).toEqual([]);

    // A table created afterwards by the same role is not handed to them either.
    await raw.query('create table public.c7_default_acl_probe (id integer)');
    expect(await apiRoleGrants()).toEqual([]);
    await raw.query('drop sequence public.c7_api_role_probe_seq');
  });

  it('leaves metra_app its grants (re-applying roles.sql changes nothing for the app)', async () => {
    const [row] = await raw.query<{ organizations: boolean; delivery_columns: number }>(
      `select has_table_privilege('metra_app', 'public.organizations', 'update') as organizations,
              (select count(*)::int from information_schema.column_privileges
                where table_schema = 'public' and table_name = 'design_engagements'
                  and grantee = 'metra_app' and privilege_type = 'UPDATE') as delivery_columns`,
    );
    expect(row).toEqual({ organizations: true, delivery_columns: 19 });
  });
});
