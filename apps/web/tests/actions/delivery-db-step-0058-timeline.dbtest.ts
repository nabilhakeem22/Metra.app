import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { seedArtifact, seedRoundBDelivery, snapshotOf } from './round-b-fixture';
import { plantEvent, plantPayment, plantTransition, retract } from './round-c-db-fixture';

// Round C, PR-C7: the client page's dated timeline in app_delivery_by_token
// (AC 34). Stage moves, the client's decisions (and the ones the studio
// recorded with evidence), and payments received; newest first, at most 60;
// no actor, note, evidence text, method or reference.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

type Entry = Record<string, unknown> & { type: string; at: string };

/** An entry minus its `at`, so the shape and order can be compared exactly. */
function withoutInstant(entry: Entry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'at'));
}

async function timelineOf(hash: string): Promise<Entry[]> {
  return (await snapshotOf(hash))!.timeline as Entry[];
}

describe('timeline (AC 34)', () => {
  it('lists 2 stages, 2 decisions and 1 payment, newest first, with only the stated fields', async () => {
    const d = await seedRoundBDelivery(orgIds, 'timeline');
    await plantTransition(d, 'created', 'design_proposal', `now() - interval '6 hours'`);
    await plantTransition(d, 'design_proposal', 'survey', `now() - interval '5 hours'`);
    await plantTransition(d, 'survey', 'survey', `now() - interval '4 hours'`);
    const option = await seedArtifact(d, 'concept_option');
    await plantEvent(d, {
      kind: 'concept_approval', chosenArtifactId: option, chosenPosition: 2, at: `now() - interval '3 hours'`,
    });
    await plantEvent(d, { kind: 'design_approval', channel: 'staff', at: `now() - interval '170 minutes'` });
    await plantEvent(d, {
      kind: 'design_approval', channel: 'staff', evidence: 'WhatsApp message', at: `now() - interval '2 hours'`,
    });
    const request = await plantEvent(d, { kind: 'design_change_request', at: `now() - interval '150 minutes'` });
    await retract(d, request);
    await plantPayment(d, 'deposit', '30000', `now() - interval '1 hour'`);

    const timeline = await timelineOf(d.hash);
    expect(timeline.map(withoutInstant)).toEqual([
      { type: 'payment', kind: 'deposit', amount: '30000.0000' },
      { type: 'decision', kind: 'design_approval', by_studio: true, option_position: null },
      { type: 'decision', kind: 'concept_approval', by_studio: false, option_position: 2 },
      { type: 'stage', state: 'survey' },
      { type: 'stage', state: 'design_proposal' },
    ]);
    const instants = timeline.map((entry) => Date.parse(entry.at));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
    expect(instants.every(Number.isFinite)).toBe(true);
  });

  it('shows staff budget and handover acknowledgements, never a staff decision without evidence', async () => {
    const d = await seedRoundBDelivery(orgIds, 'timeline-staff');
    await plantEvent(d, { kind: 'handoff_acknowledgement', channel: 'staff', at: `now() - interval '1 hour'` });
    await plantEvent(d, { kind: 'rom_acknowledgement', channel: 'staff', at: `now() - interval '2 hours'` });
    await plantEvent(d, { kind: 'concept_approval', channel: 'staff', at: `now() - interval '3 hours'` });
    await plantEvent(d, { kind: 'concept_change_request', channel: 'staff', at: `now() - interval '4 hours'` });
    await plantEvent(d, { kind: 'rom_range_set', channel: 'staff', at: `now() - interval '5 hours'` });
    expect((await timelineOf(d.hash)).map((entry) => [entry.kind, entry.by_studio])).toEqual([
      ['handoff_acknowledgement', true],
      ['rom_acknowledgement', true],
    ]);
  });

  it('returns the newest 60 of 70 entries', async () => {
    const d = await seedRoundBDelivery(orgIds, 'timeline-cap');
    await raw.query(
      `insert into public.payment_events (org_id, engagement_id, kind, amount, recorded_by, cleared_at)
       select '${d.orgId}', '${d.engagementId}', 'deposit', n, '${d.ownerId}', now() - n * interval '1 minute'
         from generate_series(1, 70) as n`,
    );
    const timeline = await timelineOf(d.hash);
    expect(timeline).toHaveLength(60);
    expect(timeline.map((entry) => entry.amount)).toEqual(
      Array.from({ length: 60 }, (_, index) => `${index + 1}.0000`),
    );
  });

  it("never lists another delivery's rows", async () => {
    const a = await seedRoundBDelivery(orgIds, 'timeline-tenant-a');
    const b = await seedRoundBDelivery(orgIds, 'timeline-tenant-b');
    await plantPayment(b, 'deposit', '500', 'now()');
    await plantTransition(b, 'created', 'design_proposal', 'now()');
    expect(await timelineOf(a.hash)).toEqual([]);
    expect(await timelineOf(b.hash)).toHaveLength(2);
  });

  it('orders same-instant entries causally and numerically, never by text (F5)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'timeline-ties');
    const at = `timestamptz '2026-10-01T10:00:00Z'`;
    await plantPayment(d, 'deposit', '9', at);
    await plantPayment(d, 'deposit', '10', at);
    await plantPayment(d, 'deposit', '100', at);
    const first = await plantEvent(d, { kind: 'design_approval', channel: 'staff', evidence: 'Signed', at });
    const second = await plantEvent(d, { kind: 'rom_acknowledgement', channel: 'staff', at });
    await plantTransition(d, 'final_approval', 'shop_drawings', at);

    const timeline = await timelineOf(d.hash);
    const decisions = [first, second].sort().reverse();
    const [idOf] = await raw.query<{ ids: Record<string, string> }>(
      `select jsonb_object_agg(id, kind) as ids from public.engagement_events where engagement_id = '${d.engagementId}'`,
    );
    expect(timeline.map((entry) => entry.type === 'payment' ? `payment:${entry.amount}` : `${entry.type}:${entry.state ?? entry.kind}`)).toEqual([
      'stage:shop_drawings',
      ...decisions.map((id) => `decision:${idOf.ids[id]}`),
      'payment:100.0000',
      'payment:10.0000',
      'payment:9.0000',
    ]);
  });
});
