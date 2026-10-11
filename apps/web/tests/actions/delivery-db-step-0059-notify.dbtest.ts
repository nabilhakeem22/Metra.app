import { createSql } from '@metra/db';
import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { seedArtifact, seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';
import { notificationsOf, plantClaim, plantEvent, sweepAs, sweepRoles } from './round-c-db-fixture';

// Round D, PR-D2 (AC N1 to N4; w3a F6): one client act is ONE count for each
// recipient, whoever notifies it first. The notifier skips a recipient who
// already has a row for the act (written or bumped at or after the act,
// read or not), except for comments, where every one is a new act.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const LOST = `now() - interval '30 minutes'`;

/** The notifier as the portal's repeat-tap repair calls it, with the app's role map. */
function notifySql(d: RoundBDelivery, bodyKey: string, milestone: string | null = null): string {
  const params = milestone ? `{"milestoneKind":"${milestone}"}` : '{}';
  return `select public.app_delivery_notify_studio_by_token('${d.hash}', '${bodyKey}', '${params}'::jsonb,
            '${JSON.stringify(sweepRoles()[bodyKey])}'::jsonb) as data`;
}

type Notified = { notified_count: number; new_recipients: string[] };
async function notify(d: RoundBDelivery, bodyKey: string, milestone: string | null = null): Promise<Notified> {
  const [row] = await raw.query<{ data: Notified }>(notifySql(d, bodyKey, milestone));
  return row.data;
}

const counts = async (engagementId: string) => (await notificationsOf(engagementId)).map((row) => row.count);

describe('one act, one count (N1 to N4)', () => {
  it('N1: the sweep notified a lost act, then a repeat tap repairs it: count 1, nobody new', async () => {
    const d = await seedRoundBDelivery(orgIds, 'n1', [{ role: 'project_manager' }]);
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    expect(await sweepAs(d.ctx)).toHaveLength(1);
    const repeat = await notify(d, 'client_handover_acknowledged');
    expect(repeat.new_recipients).toEqual([]);
    expect(repeat.notified_count).toBeGreaterThan(0);
    expect(await counts(d.engagementId)).toEqual(Array.from({ length: repeat.notified_count }, () => 1));
  });

  it('N1: the same two calls racing on the per-recipient lock still leave count 1', async () => {
    const d = await seedRoundBDelivery(orgIds, 'n1-race');
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const [first, second] = [1, 2].map(() => createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false }));
    let release = () => {};
    let firstNotified = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const notified = new Promise<void>((resolve) => (firstNotified = resolve));
    const firstDone = first.begin(async (tx) => {
      await tx.unsafe(notifySql(d, 'client_handover_acknowledged'));
      firstNotified();
      await held;
    });
    await notified;
    const secondCall = second.unsafe(notifySql(d, 'client_handover_acknowledged'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await firstDone;
    const [secondRow] = (await secondCall) as unknown as Array<{ data: Notified }>;
    await Promise.all([first.end(), second.end()]);
    expect(secondRow.data).toMatchObject({ notified_count: 1, new_recipients: [] });
    expect(await counts(d.engagementId)).toEqual([1]);
  });

  it('N2: a deposit claim dismissed and claimed again while the row is unread counts 2', async () => {
    const d = await seedRoundBDelivery(orgIds, 'n2');
    await plantClaim(d, 'deposit', `now() - interval '2 hours'`);
    await notify(d, 'client_payment_claimed', 'deposit');
    await raw.query(
      `update public.client_payment_claims set status = 'dismissed', resolved_at = now(), resolved_by = '${d.ownerId}'
        where engagement_id = '${d.engagementId}'`,
    );
    await plantClaim(d, 'deposit', 'now()');
    expect(await notify(d, 'client_payment_claimed', 'deposit')).toMatchObject({ new_recipients: [] });
    expect(await counts(d.engagementId)).toEqual([2]);
  });

  it('N3: two client comments count 2', async () => {
    const d = await seedRoundBDelivery(orgIds, 'n3');
    const artifact = await seedArtifact(d, 'approved_render');
    for (const body of ['Lighter?', 'And the floor?']) {
      await raw.query(
        `insert into public.engagement_document_comments (org_id, engagement_id, artifact_id, author_channel, author_name, body)
         values ('${d.orgId}', '${d.engagementId}', '${artifact}', 'client', 'Sam', '${body}')`,
      );
      await notify(d, 'client_commented');
    }
    expect(await counts(d.engagementId)).toEqual([2]);
  });

  it('N4: the sweep notified, the studio read it, then the tap repair adds nothing', async () => {
    const d = await seedRoundBDelivery(orgIds, 'n4');
    await plantEvent(d, { kind: 'design_change_request', at: LOST });
    await plantEvent(d, { kind: 'concept_change_request', at: LOST });
    expect(await sweepAs(d.ctx)).toHaveLength(2);
    await raw.query(`update public.notifications set read_at = now() where entity_id = '${d.engagementId}'`);
    expect(await notify(d, 'client_concept_changes_requested')).toMatchObject({ notified_count: 1, new_recipients: [] });
    expect(await notificationsOf(d.engagementId)).toHaveLength(2);
    expect(await counts(d.engagementId)).toEqual([1, 1]);
  });
});
