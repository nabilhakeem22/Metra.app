import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { resetClientCodesCore } from '@/lib/client-home/reset-codes';
import { codesOf, requestCode, seedHome, signWithCode } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Client codes DB step D (H5 security S1, the re-check M1 answer) through the
// app: the studio's "reset the client's codes" (resetClientCodesCore). Owner
// or admin only, as the share-link controls; the reset voids every code sent
// before it and lifts the delivery's own day; one audit row on the delivery.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let admin: OrgContext;
let manager: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  admin = ctxFor(orgId, seeded.memberIds[0], 'admin');
  manager = ctxFor(orgId, seeded.memberIds[1], 'project_manager');
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const auditRows = (engagementId: string) =>
  ownerQuery<{ action: string; actor_user_id: string; after: { client_codes_reset: boolean; voided_codes: number } }>(
    `select action::text as action, actor_user_id, after from public.audit_log where org_id = $1 and entity_id = $2 order by created_at`,
    [orgId, engagementId],
  );

describe('resetClientCodesCore', () => {
  it('an owner resets: the code in the client\'s mail stops working, a new one is made at once, one audit row', async () => {
    const home = await seedHome(orgId);
    const before = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await resetClientCodesCore(owner, home.delivery.id.toUpperCase())).toEqual({ ok: true, data: { voided: 1 } });
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, before.code)).toEqual({ code: 'code_unknown' });
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.status).toBe('ok');
    expect(await codesOf(home.delivery.id)).toHaveLength(2);
    expect(await auditRows(home.delivery.id)).toEqual([
      { action: 'update', actor_user_id: owner.userId, after: { client_codes_reset: true, voided_codes: 1 } },
    ]);
  });

  it('an admin may; a project manager is forbidden and nothing changes', async () => {
    const home = await seedHome(orgId);
    expect(await resetClientCodesCore(manager, home.delivery.id)).toEqual({ ok: false, error: 'forbidden' });
    const [row] = await ownerQuery<{ reset_at: string | null }>(
      `select client_codes_reset_at as reset_at from public.design_engagements where id = $1`,
      [home.delivery.id],
    );
    expect(row.reset_at).toBeNull();
    expect(await auditRows(home.delivery.id)).toEqual([]);
    expect(await resetClientCodesCore(admin, home.delivery.id)).toEqual({ ok: true, data: { voided: 0 } });
  });

  it('a delivery of another studio, or no delivery at all, is engagement_not_found', async () => {
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const theirs = await seedHome(other.orgId);
    expect(await resetClientCodesCore(owner, theirs.delivery.id)).toMatchObject({ ok: false, error: 'engagement_not_found' });
    expect(await resetClientCodesCore(owner, 'not-a-uuid')).toMatchObject({ ok: false, error: 'engagement_not_found' });
  });
});
