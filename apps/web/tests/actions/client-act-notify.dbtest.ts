import { afterAll, describe, expect, it } from 'vitest';
import { clientActOfVerb, paymentClaimedAct } from '@/lib/engagements/client-acts/acts';
import { notifyStudioOfClientAct, withStudioNotified } from '@/lib/engagements/client-acts/notify';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';

// Round B, B10 (AC 36): the portal's notifier wrapper against the real
// app_delivery_notify_studio_by_token. The roles come from the permission
// matrix (owner decision Q2), the key and params from the act, and the portal
// learns one boolean. Outside a request there is no `after()` and no origin,
// so no email is attempted here; the wrapper must still answer.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Row {
  recipient_user_id: string;
  body_key: string;
  entity_id: string | null;
  params: Record<string, unknown>;
}

async function rowsOf(orgId: string): Promise<Row[]> {
  return raw.query<Row>(
    `select recipient_user_id, body_key, entity_id, params from public.notifications
      where org_id = '${orgId}' and kind = 'client_responded'
      order by recipient_user_id, created_at`,
  );
}

type Studio = RoundBDelivery & { ids: Record<string, string> };

async function seedStudio(suffix: string): Promise<Studio> {
  const delivery = await seedRoundBDelivery(orgIds, suffix, [
    { role: 'admin' },
    { role: 'project_manager' },
    { role: 'site_engineer' },
    { role: 'accountant' },
    { role: 'viewer' },
    { role: 'client' },
  ]);
  const [admin, projectManager, siteEngineer, accountant, viewer, client] = delivery.memberIds;
  return {
    ...delivery,
    ids: {
      owner: delivery.ownerId,
      admin,
      projectManager,
      siteEngineer,
      accountant,
      viewer,
      client,
    },
  };
}

describe('notifyStudioOfClientAct', () => {
  it('a design act reaches owner, admin, PM and site engineer of that org, linked to the delivery', async () => {
    const studio = await seedStudio('b10-design');
    await forceState(studio.engagementId, 'final_approval');
    const written = await recordDeliveryActionByToken(studio.token, { action: 'approve_design' });
    expect(written).toEqual({ ok: true });

    expect(await withStudioNotified(studio.token, written, clientActOfVerb('approve_design'))).toEqual({
      ok: true,
      studioNotified: true,
    });
    const rows = await rowsOf(studio.orgId);
    expect(rows.map((row) => row.recipient_user_id).sort()).toEqual(
      [studio.ids.owner, studio.ids.admin, studio.ids.projectManager, studio.ids.siteEngineer].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        body_key: 'client_design_approved',
        entity_id: studio.engagementId,
      });
      expect(row.params.count).toBe(1);
    }
  });

  it('an `already` repeat never calls the notifier; a second real act bumps the count', async () => {
    const studio = await seedStudio('b10-repeat');
    await forceState(studio.engagementId, 'final_approval');
    const first = await recordDeliveryActionByToken(studio.token, { action: 'approve_design' });
    await withStudioNotified(studio.token, first, clientActOfVerb('approve_design'));

    const repeat = await recordDeliveryActionByToken(studio.token, { action: 'approve_design' });
    expect(repeat).toEqual({ ok: true, code: 'already' });
    expect(await withStudioNotified(studio.token, repeat, clientActOfVerb('approve_design'))).toEqual({
      ok: true,
      code: 'already',
      studioNotified: false,
    });
    expect((await rowsOf(studio.orgId)).every((row) => row.params.count === 1)).toBe(true);

    // A comment burst is several real acts: one unread row per member, counted.
    await notifyStudioOfClientAct(studio.token, { kind: 'commented' });
    await notifyStudioOfClientAct(studio.token, { kind: 'commented' });
    const comments = (await rowsOf(studio.orgId)).filter((row) => row.body_key === 'client_commented');
    expect(comments).toHaveLength(4);
    expect(comments.every((row) => row.params.count === 2)).toBe(true);
  });

  it('a payment claim reaches owner, admin and accountant, naming the milestone', async () => {
    const studio = await seedStudio('b10-payment');
    expect(await notifyStudioOfClientAct(studio.token, paymentClaimedAct('gate_a')!)).toEqual({
      studioNotified: true,
    });
    const rows = await rowsOf(studio.orgId);
    expect(rows.map((row) => row.recipient_user_id).sort()).toEqual(
      [studio.ids.owner, studio.ids.admin, studio.ids.accountant].sort(),
    );
    expect(rows.every((row) => row.params.milestoneKind === 'gate_a')).toBe(true);
    expect(rows.every((row) => row.body_key === 'client_payment_claimed')).toBe(true);
  });

  it('a revoked link notifies nobody and says so', async () => {
    const studio = await seedStudio('b10-revoked');
    expect((await revokeDeliveryLinkCore(studio.ctx, studio.engagementId)).ok).toBe(true);
    expect(await notifyStudioOfClientAct(studio.token, { kind: 'commented' })).toEqual({
      studioNotified: false,
    });
    expect(await rowsOf(studio.orgId)).toEqual([]);
  });
});
