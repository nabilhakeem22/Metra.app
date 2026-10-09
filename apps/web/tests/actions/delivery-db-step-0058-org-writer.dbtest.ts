import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { STUDIO_DETAILS, updateOrganization } from './round-c-org-fixture';

// Round C, PR-C7 fix round (S1): trg_organizations_client_page_writer. Only an
// owner or admin of the org (the app's GUCs) may change the studio's phone,
// WhatsApp or payment details; anyone else gets SQLSTATE MT120 and the whole
// statement rolls back. Every other organizations column is untouched.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const REFUSED_ROLES = ['viewer', 'project_manager', 'site_engineer', 'accountant', 'client'] as const;

async function studio() {
  const seeded = await seedOrg({ owners: 1, members: [...REFUSED_ROLES.map((role) => ({ role })), { role: 'admin' }] });
  orgIds.push(seeded.orgId);
  return seeded;
}

const ibanOf = async (orgId: string) =>
  (await raw.query<{ iban: string | null }>(`select bank_iban as iban from public.organizations where id = '${orgId}'`))[0].iban;

describe('the client page details are owner/admin only (S1)', () => {
  it('refuses viewer, project manager, site engineer, accountant and client on each of the seven columns', async () => {
    const { orgId, memberIds } = await studio();
    for (const [index, role] of REFUSED_ROLES.entries()) {
      for (const [column, value] of Object.entries(STUDIO_DETAILS)) {
        const assignment = column === 'bank_account_number' || column === 'bank_iban'
          ? `bank_name = 'CIB', ${column} = '${value}'` : `${column} = '${value}'`;
        expect(await updateOrganization(orgId, assignment, { userId: memberIds[index] }), `${role} ${column}`).toBe('MT120');
      }
    }
    expect(await ibanOf(orgId)).toBeNull();
  });

  it('lets the owner and an admin change them', async () => {
    const { orgId, ownerIds, memberIds } = await studio();
    const admin = memberIds[REFUSED_ROLES.length];
    expect(await updateOrganization(orgId, `bank_name = 'CIB', bank_iban = 'EG380019000500000000263180002'`, { userId: ownerIds[0] })).toBe('ok');
    expect(await updateOrganization(orgId, `bank_iban = 'EG110003000100000000000000001'`, { userId: admin })).toBe('ok');
    expect(await ibanOf(orgId)).toBe('EG110003000100000000000000001');
  });

  it('refuses a caller with no GUCs, and an owner naming another org', async () => {
    const mine = await studio();
    const theirs = await studio();
    expect(await updateOrganization(theirs.orgId, `studio_phone = '0225550000'`, null)).toBe('MT120');
    // An owner of `mine`, with GUCs that name `theirs`, then with GUCs that name `mine`.
    expect(await updateOrganization(theirs.orgId, `studio_phone = '0225550000'`, { userId: mine.ownerIds[0] })).toBe('MT120');
    expect(
      await updateOrganization(theirs.orgId, `studio_phone = '0225550000'`, { userId: mine.ownerIds[0], orgId: mine.orgId }),
    ).toBe('MT120');
  });

  it('leaves every other column alone: a viewer may still write what RLS lets them, and a no-op passes', async () => {
    const { orgId, ownerIds, memberIds } = await studio();
    const viewer = { userId: memberIds[0] };
    expect(await updateOrganization(orgId, `city = 'Cairo', name_ar = 'استوديو'`, viewer)).toBe('ok');
    expect(await updateOrganization(orgId, `studio_phone = '01012345678'`, { userId: ownerIds[0] })).toBe('ok');
    expect(await updateOrganization(orgId, `studio_phone = '01012345678', city = 'Giza'`, viewer)).toBe('ok');
    expect(await updateOrganization(orgId, `studio_phone = null`, viewer)).toBe('MT120');
  });

  it('holds on the app path too: as metra_app, a viewer is refused and the owner is not', async () => {
    const { orgId, ownerIds, memberIds } = await studio();
    const write = (userId: string, role: 'viewer' | 'owner') =>
      withOrgContext(ctxFor(orgId, userId, role), (tx) =>
        tx.execute(sql`update public.organizations set instapay_address = 'studio@instapay' where id = ${orgId}`),
      ).then(() => 'ok', (error: unknown) => sqlstateOf(error));
    expect(await write(memberIds[0], 'viewer')).toBe('MT120');
    expect(await write(ownerIds[0], 'owner')).toBe('ok');
  });

  it('is a SECURITY DEFINER trigger function no API role may execute', async () => {
    const [fn] = await raw.query<{ definer: boolean; config: string[]; public_grants: number }>(
      `select p.prosecdef as definer, p.proconfig as config,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public_grants
         from pg_proc p where p.proname = 'enforce_client_page_details_writer'`,
    );
    expect(fn).toEqual({ definer: true, config: ['search_path=""'], public_grants: 0 });
  });
});
