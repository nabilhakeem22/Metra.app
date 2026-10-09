import { afterAll, describe, expect, it } from 'vitest';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedArtifact, seedRoundBDelivery, stampRenders } from './round-b-fixture';
import { notificationsOf, plantClaim, plantEvent, sweepAs } from './round-c-db-fixture';

// Round C, PR-C7: what the lost-notification sweep repairs (AC 40). An act in
// [now - 48 h, now - 10 min] that no notification answers is notified ONCE,
// through the real notifier (its recipients, dedupe and params); nothing else
// is touched, in this org or any other, and no client is ever a recipient.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const LOST = `now() - interval '30 minutes'`;

describe('app_notify_lost_client_acts: the repair (AC 40)', () => {
  it('notifies a lost design approval once; the next call finds nothing', async () => {
    const d = await seedRoundBDelivery(orgIds, 'sweep-design');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '2 hours'`);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({ ok: true });
    await raw.query(
      `update public.engagement_events set decided_at = ${LOST} where engagement_id = '${d.engagementId}'`,
    );
    const first = await sweepAs(d.ctx);
    expect(first).toEqual([
      {
        body_key: 'client_design_approved',
        milestone_kind: null,
        notified: expect.objectContaining({
          engagement_id: d.engagementId, notified_count: 1, new_recipients: [d.ownerId],
        }),
      },
    ]);
    expect(await notificationsOf(d.engagementId)).toEqual([
      { recipient_user_id: d.ownerId, body_key: 'client_design_approved', milestone: null, count: 1 },
    ]);
    expect(await sweepAs(d.ctx)).toEqual([]);
    expect(await notificationsOf(d.engagementId)).toHaveLength(1);
  });

  it('leaves an act younger than 10 minutes and one older than 48 hours alone', async () => {
    const d = await seedRoundBDelivery(orgIds, 'sweep-window');
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: `now() - interval '5 minutes'` });
    await plantEvent(d, { kind: 'rom_acknowledgement', at: `now() - interval '3 days'` });
    expect(await sweepAs(d.ctx)).toEqual([]);
    expect(await notificationsOf(d.engagementId)).toEqual([]);
  });

  it('skips an act already notified, and repairs one whose only notification is OLDER than it', async () => {
    const d = await seedRoundBDelivery(orgIds, 'sweep-notified');
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    await plantEvent(d, { kind: 'concept_change_request', at: LOST });
    const notify = (bodyKey: string) =>
      raw.query(`select public.app_delivery_notify_studio_by_token('${d.hash}', '${bodyKey}', '{}'::jsonb, '["owner"]'::jsonb)`);
    await notify('client_handover_acknowledged');
    await notify('client_concept_changes_requested');
    // The change-request notification predates the act (an earlier round's).
    await raw.query(
      `update public.notifications set created_at = now() - interval '1 day'
        where entity_id = '${d.engagementId}' and body_key = 'client_concept_changes_requested'`,
    );
    const repaired = await sweepAs(d.ctx);
    expect(repaired!.map((entry) => entry.body_key)).toEqual(['client_concept_changes_requested']);
    // The notifier's own dedupe: the unread row is bumped, no second row, no new recipient to email.
    expect(repaired![0].notified).toMatchObject({ notified_count: 1, new_recipients: [] });
    expect(await notificationsOf(d.engagementId)).toEqual([
      { recipient_user_id: d.ownerId, body_key: 'client_concept_changes_requested', milestone: null, count: 2 },
      { recipient_user_id: d.ownerId, body_key: 'client_handover_acknowledged', milestone: null, count: 1 },
    ]);
  });

  it('a lost deposit claim and a lost gate_a claim are two entries; a lost comment is notified', async () => {
    const d = await seedRoundBDelivery(orgIds, 'sweep-claims', [{ role: 'accountant' }, { role: 'project_manager' }]);
    await plantClaim(d, 'deposit', LOST);
    await plantClaim(d, 'gate_a', LOST);
    const artifact = await seedArtifact(d, 'approved_render');
    await raw.query(
      `insert into public.engagement_document_comments
         (org_id, engagement_id, artifact_id, author_channel, author_name, body, created_at)
       values ('${d.orgId}', '${d.engagementId}', '${artifact}', 'client', 'Sam', 'Lighter?', ${LOST})`,
    );
    const entries = await sweepAs(d.ctx);
    expect(entries!.map((entry) => [entry.body_key, entry.milestone_kind])).toEqual([
      ['client_payment_claimed', 'deposit'],
      ['client_payment_claimed', 'gate_a'],
      ['client_commented', null],
    ]);
    const [accountant, pm] = d.memberIds;
    const rows = await notificationsOf(d.engagementId);
    // The matrix decides who hears: the finance roles for a claim, the design roles for a comment.
    expect(rows.filter((row) => row.body_key === 'client_payment_claimed').map((row) => row.recipient_user_id).sort())
      .toEqual([d.ownerId, d.ownerId, accountant, accountant].sort());
    expect(rows.filter((row) => row.body_key === 'client_commented').map((row) => row.recipient_user_id).sort())
      .toEqual([d.ownerId, pm].sort());
    expect(await sweepAs(d.ctx)).toEqual([]);
  });

  it('never touches another org, and never notifies a client member even if the role map names the client', async () => {
    const mine = await seedRoundBDelivery(orgIds, 'sweep-tenant-mine', [{ role: 'client' }]);
    const theirs = await seedRoundBDelivery(orgIds, 'sweep-tenant-theirs');
    await plantEvent(theirs, { kind: 'handoff_acknowledgement', at: LOST });
    await plantEvent(mine, { kind: 'handoff_acknowledgement', at: LOST });
    const roles = { client_handover_acknowledged: ['owner', 'client'] };
    const entries = await sweepAs(mine.ctx, undefined, undefined, roles);
    expect(entries!.map((entry) => entry.notified?.engagement_id)).toEqual([mine.engagementId]);
    expect((await notificationsOf(mine.engagementId)).map((row) => row.recipient_user_id)).toEqual([mine.ownerId]);
    expect(await notificationsOf(theirs.engagementId)).toEqual([]);
  });
});
