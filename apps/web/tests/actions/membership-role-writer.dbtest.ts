import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { changeMemberRoleCore, removeMemberCore } from '@/lib/team/core';
import { appQuery, closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Security batch 3, A5: trg_memberships_role_writer (rls/policies/00-core.sql,
// enforce_membership_role_writer in rls/functions/00-org-context.sql). The
// database now says what lib/team/core has always enforced: only an owner or
// admin grants, changes or removes a role, and only an owner touches owner.
// Every refusal here is raw SQL as metra_app in a real member's context (an
// app bug, an injected statement); the cores refuse earlier with their own
// codes. The bootstrap inserts are membership-role-writer-bootstrap.dbtest.ts.

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

type Studio = Record<'orgId' | 'owner' | 'secondOwner' | 'admin' | 'manager' | 'viewer', string>;

async function seedStudio(): Promise<Studio> {
  const seeded = await seedOrg({ owners: 2, members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'viewer' }] });
  const { orgId, ownerIds: [owner, secondOwner], memberIds: [admin, manager, viewer] } = seeded;
  orgIds.push(orgId);
  return { orgId, owner, secondOwner, admin, manager, viewer };
}

/** The SQLSTATE a membership statement is refused with as `actor` under metra_app, or null when it ran. */
function writeAs(studio: Studio, actor: string, statement: string): Promise<string | null> {
  return sqlstate(appQuery(studio.orgId, actor, statement.replaceAll('$org', `'${studio.orgId}'`)));
}

const setRole = (member: string, role: string) => `update public.memberships set role = '${role}' where org_id = $org and user_id = '${member}'`;
const remove = (member: string) => `delete from public.memberships where org_id = $org and user_id = '${member}'`;

async function rolesOf(studio: Studio): Promise<Record<string, string>> {
  return Object.fromEntries((await raw.memberships(studio.orgId)).map((row) => [row.user_id, row.role]));
}

describe('the cores still work for the roles the app allows (AC21)', () => {
  it('an admin changes a project manager to viewer, and removes a viewer', async () => {
    const studio = await seedStudio();
    const admin = ctxFor(studio.orgId, studio.admin, 'admin');
    expect(await changeMemberRoleCore(admin, { userId: studio.manager, role: 'viewer' })).toMatchObject({ ok: true });
    expect(await removeMemberCore(admin, studio.viewer)).toMatchObject({ ok: true });
    expect(await rolesOf(studio)).toEqual({ [studio.owner]: 'owner', [studio.secondOwner]: 'owner', [studio.admin]: 'admin', [studio.manager]: 'viewer' });
  });

  it('an owner makes a viewer an owner and demotes the second owner through the core', async () => {
    const studio = await seedStudio();
    const owner = ctxFor(studio.orgId, studio.owner, 'owner');
    expect(await changeMemberRoleCore(owner, { userId: studio.viewer, role: 'owner' })).toMatchObject({ ok: true });
    expect(await changeMemberRoleCore(owner, { userId: studio.secondOwner, role: 'admin' })).toMatchObject({ ok: true });
    expect(await rolesOf(studio)).toMatchObject({ [studio.viewer]: 'owner', [studio.secondOwner]: 'admin' });
  });
});

describe('a member who is not an owner or admin writes no role (AC22)', () => {
  it.each(['manager', 'viewer'] as const)('a %s changing a role, promoting himself or removing a member is MT150, and nothing changes', async (actorKey) => {
    const studio = await seedStudio();
    const actor = studio[actorKey];
    const before = await rolesOf(studio);
    expect(await writeAs(studio, actor, setRole(studio.admin, 'viewer'))).toBe('MT150');
    expect(await writeAs(studio, actor, setRole(actor, 'owner'))).toBe('MT150');
    expect(await writeAs(studio, actor, setRole(actor, 'admin'))).toBe('MT150');
    expect(await writeAs(studio, actor, remove(studio.admin))).toBe('MT150');
    expect(await writeAs(studio, actor, `insert into public.memberships (org_id, user_id, role) values ($org, '${randomUUID()}', 'viewer')`)).toBe('MT150');
    expect(await rolesOf(studio)).toEqual(before);
  });

  it('an update that leaves the role as it was is not judged', async () => {
    const studio = await seedStudio();
    expect(await writeAs(studio, studio.viewer, `update public.memberships set updated_at = now() where org_id = $org and user_id = '${studio.viewer}'`)).toBeNull();
  });
});

describe('only an owner touches owner (AC23)', () => {
  it('an admin granting owner, demoting an owner or removing an owner is MT150; other roles are his to write', async () => {
    const studio = await seedStudio();
    const before = await rolesOf(studio);
    expect(await writeAs(studio, studio.admin, setRole(studio.viewer, 'owner'))).toBe('MT150');
    expect(await writeAs(studio, studio.admin, setRole(studio.admin, 'owner'))).toBe('MT150');
    expect(await writeAs(studio, studio.admin, setRole(studio.secondOwner, 'admin'))).toBe('MT150');
    expect(await writeAs(studio, studio.admin, remove(studio.secondOwner))).toBe('MT150');
    expect(await writeAs(studio, studio.admin, `insert into public.memberships (org_id, user_id, role) values ($org, '${randomUUID()}', 'owner')`)).toBe('MT150');
    expect(await rolesOf(studio)).toEqual(before);

    expect(await writeAs(studio, studio.admin, setRole(studio.viewer, 'project_manager'))).toBeNull();
    expect(await writeAs(studio, studio.admin, remove(studio.manager))).toBeNull();
    expect(await rolesOf(studio)).toMatchObject({ [studio.viewer]: 'project_manager' });
  });

  it('an owner does each of them', async () => {
    const studio = await seedStudio();
    expect(await writeAs(studio, studio.owner, setRole(studio.viewer, 'owner'))).toBeNull();
    expect(await writeAs(studio, studio.owner, setRole(studio.secondOwner, 'admin'))).toBeNull();
    expect(await writeAs(studio, studio.owner, remove(studio.viewer))).toBeNull();
    expect(await rolesOf(studio)).toEqual({ [studio.owner]: 'owner', [studio.secondOwner]: 'admin', [studio.admin]: 'admin', [studio.manager]: 'project_manager' });
  });
});

describe('a membership never moves (AC24)', () => {
  it('changing user_id or org_id is MT150 for an owner too', async () => {
    const studio = await seedStudio();
    const other = await seedStudio();
    const row = `where org_id = $org and user_id = '${studio.viewer}'`;
    expect(await writeAs(studio, studio.owner, `update public.memberships set user_id = '${randomUUID()}' ${row}`)).toBe('MT150');
    expect(await writeAs(studio, studio.owner, `update public.memberships set org_id = '${other.orgId}' ${row}`)).toBe('MT150');
    expect(await writeAs(studio, studio.owner, `update public.memberships set org_id = '${other.orgId}', role = 'admin' ${row}`)).toBe('MT150');
    expect((await rolesOf(studio))[studio.viewer]).toBe('viewer');
    expect((await rolesOf(other))[studio.viewer]).toBeUndefined();
  });
});

describe('the connection role is not judged, and the objects are what the rule needs (AC27)', () => {
  it('inserts, changes and removes any role as the connection role', async () => {
    const studio = await seedStudio();
    const member = randomUUID();
    await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [studio.orgId, member]);
    await ownerQuery(`update public.memberships set role = 'viewer' where org_id = $1 and user_id = $2`, [studio.orgId, member]);
    await ownerQuery(`update public.memberships set role = 'owner' where org_id = $1 and user_id = $2`, [studio.orgId, member]);
    await ownerQuery(`delete from public.memberships where org_id = $1 and user_id = $2`, [studio.orgId, studio.owner]);
    expect(await rolesOf(studio)).toMatchObject({ [member]: 'owner' });
    expect((await rolesOf(studio))[studio.owner]).toBeUndefined();
  });

  it('the trigger fires before every row write; its function is an invoker and the fact reader a definer, both for metra_app only', async () => {
    const [trigger] = await ownerQuery<{ definition: string }>(
      `select pg_get_triggerdef(t.oid) as definition from pg_trigger t
        where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'trg_memberships_role_writer'`,
    );
    expect(trigger.definition).toMatch(/BEFORE INSERT OR DELETE OR UPDATE ON public\.memberships FOR EACH ROW EXECUTE FUNCTION (public\.)?enforce_membership_role_writer\(\)/);
    const functions = await ownerQuery(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('metra_app', p.oid, 'execute') as metra_app,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public_grants
         from pg_proc p
        where p.oid in ('public.app_membership_writer_facts()'::regprocedure, 'public.enforce_membership_role_writer()'::regprocedure)
        order by 1`,
    );
    expect(functions).toEqual([
      { name: 'app_membership_writer_facts', definer: true, config: ['search_path=""'], metra_app: true, public_grants: 0 },
      { name: 'enforce_membership_role_writer', definer: false, config: ['search_path=""'], metra_app: true, public_grants: 0 },
    ]);
  });
});
