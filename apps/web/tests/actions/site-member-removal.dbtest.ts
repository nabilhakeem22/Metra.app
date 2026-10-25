import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postLoginPathFor } from '@/lib/auth/post-login-path';
import { assignSiteMemberCore, unassignSiteMemberCore } from '@/lib/site/assignments/core';
import { removeMemberCore } from '@/lib/team/core';
import { closeExecutionFixture, ownerQuery, seedClientProject, sqlstate } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { appInsert, ownerInsert, seedMember, visitRow } from './site-fixture';

// PR S3: removing a member closes what he had on the site side (plan C3,
// AC7's database half: his live assignments and his phones in THAT studio get
// `revoked_at`, by the remover, audited; the database then refuses his diary
// writes), and the sign-in landing read from real memberships (AC8).

// The site app ships in PR S4; these tests switch its landing on to prove the rule.
const siteApp = vi.hoisted(() => ({ live: true }));
vi.mock('@/lib/site/app-live', () => ({
  get SITE_APP_LIVE() {
    return siteApp.live;
  },
}));

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let adminId: string;
let otherOrgId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }] });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  adminId = seeded.memberIds[0];
  otherOrgId = (await seedOrg({ owners: 1 })).orgId;
  orgIds.push(orgId, otherOrgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const ownerCtx = () => ctxFor(orgId, ownerId, 'owner');

async function seedDevice(org: string, userId: string, revokedBy: string | null = null): Promise<string> {
  return ownerInsert('site_devices', {
    org_id: org,
    user_id: userId,
    auth_session_id: randomUUID(),
    label: 'Android · Chrome',
    revoked_at: revokedBy ? new Date('2026-10-01T00:00:00Z') : null,
    revoked_by: revokedBy,
  });
}

/** The same engineer in this studio and in another one, with assignments and phones in both. */
async function engineerOnTwoStudios() {
  const engineerId = await seedMember(orgId, 'site_engineer');
  await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'site_engineer')`, [otherOrgId, engineerId]);
  const [first, second, earlier] = [
    (await seedClientProject(orgId)).projectId,
    (await seedClientProject(orgId)).projectId,
    (await seedClientProject(orgId)).projectId,
  ];
  const elsewhere = (await seedClientProject(otherOrgId)).projectId;
  await assignSiteMemberCore(ownerCtx(), { projectId: first, userId: engineerId });
  await assignSiteMemberCore(ownerCtx(), { projectId: second, userId: engineerId });
  await assignSiteMemberCore(ownerCtx(), { projectId: earlier, userId: engineerId });
  await unassignSiteMemberCore(ctxFor(orgId, adminId, 'admin'), { projectId: earlier, userId: engineerId });
  const [otherOwner] = await ownerQuery<{ user_id: string }>(
    `select user_id from public.memberships where org_id = $1 and role = 'owner'`,
    [otherOrgId],
  );
  await ownerQuery(`insert into public.project_assignments (org_id, project_id, user_id, assigned_by) values ($1, $2, $3, $4)`, [
    otherOrgId,
    elsewhere,
    engineerId,
    otherOwner.user_id,
  ]);
  const devices = {
    live: await seedDevice(orgId, engineerId),
    alreadyRevoked: await seedDevice(orgId, engineerId, adminId),
    otherStudio: await seedDevice(otherOrgId, engineerId),
  };
  return { engineerId, first, second, devices };
}

const live = async (table: string, org: string, userId: string) =>
  ownerQuery<{ id: string }>(`select id from public.${table} where org_id = $1 and user_id = $2 and revoked_at is null`, [org, userId]);

describe('removeMemberCore closes the member site side in that studio (AC7)', () => {
  it('revokes his live assignments and phones, stamped with the remover, and leaves the other studio alone', async () => {
    const { engineerId, devices } = await engineerOnTwoStudios();
    const [revokedEarlier] = await ownerQuery<{ revoked_by: string; revoked_at: Date }>(
      `select revoked_by, revoked_at from public.project_assignments where org_id = $1 and user_id = $2 and revoked_at is not null`,
      [orgId, engineerId],
    );

    expect(await removeMemberCore(ctxFor(orgId, adminId, 'admin'), engineerId)).toMatchObject({ ok: true });

    expect(await live('project_assignments', orgId, engineerId)).toEqual([]);
    expect(await live('site_devices', orgId, engineerId)).toEqual([]);
    const closed = await ownerQuery<{ revoked_by: string; revoked_at: Date }>(
      `select revoked_by, revoked_at from public.project_assignments where org_id = $1 and user_id = $2 order by created_at`,
      [orgId, engineerId],
    );
    expect(closed.map((row) => row.revoked_by)).toEqual([adminId, adminId, adminId]);
    expect(closed[2], 'the earlier revoke keeps its own stamp').toEqual(revokedEarlier);
    const [kept] = await ownerQuery<{ revoked_by: string }>(`select revoked_by from public.site_devices where id = $1`, [devices.alreadyRevoked]);
    expect(kept.revoked_by).toBe(adminId);
    const [phone] = await ownerQuery<{ revoked_by: string }>(`select revoked_by from public.site_devices where id = $1`, [devices.live]);
    expect(phone.revoked_by).toBe(adminId);

    expect(await live('project_assignments', otherOrgId, engineerId), 'his other studio keeps him').toHaveLength(1);
    expect(await live('site_devices', otherOrgId, engineerId)).toHaveLength(1);
    expect(await ownerQuery(`select 1 from public.memberships where org_id = $1 and user_id = $2`, [orgId, engineerId])).toEqual([]);
  });

  it('audits each closed assignment and phone, and the removal itself', async () => {
    const { engineerId, devices } = await engineerOnTwoStudios();
    await removeMemberCore(ownerCtx(), engineerId);
    const audit = await ownerQuery<{ entity: string; entity_id: string; action: string; actor_user_id: string; after: Record<string, unknown> | null }>(
      `select entity, entity_id, action, actor_user_id, after from public.audit_log
        where org_id = $1 and actor_user_id = $2 and created_at > now() - interval '1 minute'
          and (after ->> 'via' = 'member_removed' or (entity = 'membership' and action = 'delete'))`,
      [orgId, ownerId],
    );
    const viaRemoval = audit.filter((row) => row.after?.via === 'member_removed' && row.after?.user_id === engineerId);
    expect(viaRemoval.filter((row) => row.entity === 'project_assignment')).toHaveLength(2);
    expect(viaRemoval.filter((row) => row.entity === 'site_device').map((row) => row.entity_id)).toEqual([devices.live]);
    expect(viaRemoval.every((row) => row.action === 'update' && row.actor_user_id === ownerId)).toBe(true);
    expect(audit.some((row) => row.entity === 'membership' && row.action === 'delete')).toBe(true);
  });

  it('the database then refuses his diary writes on the project he was on (42501)', async () => {
    const { engineerId, first } = await engineerOnTwoStudios();
    await expect(appInsert(orgId, engineerId, 'site_visits', visitRow(orgId, first, engineerId)), 'assigned: he checks in').resolves.toBeDefined();
    await removeMemberCore(ownerCtx(), engineerId);
    expect(await sqlstate(appInsert(orgId, engineerId, 'site_visits', visitRow(orgId, first, engineerId)))).toBe('42501');
  });

  it('a removal refused (the last owner) closes nothing', async () => {
    const soleOwnerOrg = await seedOrg({ owners: 1, members: [{ role: 'admin' }] });
    orgIds.push(soleOwnerOrg.orgId);
    const [soleOwner] = soleOwnerOrg.ownerIds;
    const project = (await seedClientProject(soleOwnerOrg.orgId)).projectId;
    await assignSiteMemberCore(ctxFor(soleOwnerOrg.orgId, soleOwner, 'owner'), { projectId: project, userId: soleOwner });
    const adminCtx = ctxFor(soleOwnerOrg.orgId, soleOwnerOrg.memberIds[0], 'admin');
    expect(await removeMemberCore(adminCtx, soleOwner)).toMatchObject({ ok: false, error: 'owner_immutable' });
    expect(await live('project_assignments', soleOwnerOrg.orgId, soleOwner)).toHaveLength(1);
  });
});

describe('postLoginPathFor reads the landing from real memberships (AC8)', () => {
  beforeEach(() => {
    siteApp.live = true;
  });

  it('a user whose only membership is site engineer gets /site, and with return=site too', async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    expect(await postLoginPathFor(engineerId)).toBe('/site');
    expect(await postLoginPathFor(engineerId, 'site')).toBe('/site');
  });

  it('an engineer who is a project manager in another studio lands on the dashboard; return=site still says /site', async () => {
    const engineerId = await seedMember(orgId, 'site_engineer');
    await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'project_manager')`, [otherOrgId, engineerId]);
    expect(await postLoginPathFor(engineerId)).toBe('/dashboard');
    expect(await postLoginPathFor(engineerId, 'site')).toBe('/site');
  });

  it('an owner without return=site still gets /dashboard, and nobody gets onboarding', async () => {
    expect(await postLoginPathFor(ownerId)).toBe('/dashboard');
    expect(await postLoginPathFor(randomUUID())).toBe('/onboarding');
  });

  it('before the site app is live, the engineer lands on the dashboard as today', async () => {
    siteApp.live = false;
    const engineerId = await seedMember(orgId, 'site_engineer');
    expect(await postLoginPathFor(engineerId)).toBe('/dashboard');
    expect(await postLoginPathFor(engineerId, 'site')).toBe('/dashboard');
  });
});
