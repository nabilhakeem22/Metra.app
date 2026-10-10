import { afterAll, describe, expect, it } from 'vitest';
import { acknowledgeHandoverAndNotify } from '@/lib/engagements/client-acts/handover-acts';
import {
  approveDesignWithBudgetAndNotify,
  respondToDesignAndNotify,
} from '@/lib/engagements/client-acts/design-acts';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { notificationsOf, retract } from './round-c-db-fixture';

// Round C, PR-C10 (AC 54 to 56), through the real write, read and notifier:
// approve with the budget in one confirmation, and design / handover repeat
// taps that confirm only the decision SAVED on file.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** A delivery at final approval with renders issued, its band issued too. */
async function atFinalApproval(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `now() - interval '1 hour'`);
  await raw.query(
    `update public.design_engagements set rom_low = 900000, rom_high = 1200000, rom_issued_at = now() - interval '2 hours'
      where id = '${d.engagementId}'`,
  );
  return d;
}

async function clientEvents(d: RoundBDelivery): Promise<string[]> {
  const rows = await raw.query<{ kind: string }>(
    `select kind from public.engagement_events
      where engagement_id = '${d.engagementId}' and actor_channel = 'client' order by kind`,
  );
  return rows.map((row) => row.kind);
}

async function bodyKeyCounts(d: RoundBDelivery): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of await notificationsOf(d.engagementId)) counts[row.body_key] = (counts[row.body_key] ?? 0) + 1;
  return counts;
}

describe('approve with the budget in one confirmation (AC 54)', () => {
  it('writes the client design approval AND the client budget acknowledgement', async () => {
    const d = await atFinalApproval('c10-both');
    expect(await approveDesignWithBudgetAndNotify(d.token, { note: 'Lovely' })).toEqual({
      kind: 'approved',
      studioNotified: true,
      budgetAcknowledged: true,
    });
    expect(await clientEvents(d)).toEqual(['design_approval', 'rom_acknowledgement']);
    expect(Object.keys(await bodyKeyCounts(d)).sort()).toEqual(['client_budget_acknowledged', 'client_design_approved']);
  });

  it('a refused acknowledgement leaves the approval standing', async () => {
    const d = await atFinalApproval('c10-refused');
    // The band is no longer issued: the acknowledgement has nothing to answer.
    await raw.query(`update public.design_engagements set rom_issued_at = null where id = '${d.engagementId}'`);
    expect(await approveDesignWithBudgetAndNotify(d.token, {})).toEqual({
      kind: 'approved',
      studioNotified: true,
      budgetAcknowledged: false,
    });
    expect(await clientEvents(d)).toEqual(['design_approval']);
  });

  it('a stale tab whose saved answer is a change request acknowledges nothing', async () => {
    const d = await atFinalApproval('c10-stale-budget');
    await respondToDesignAndNotify(d.token, { action: 'request_design_changes', note: 'Darker' });
    expect(await approveDesignWithBudgetAndNotify(d.token, {})).toEqual({ kind: 'changes_requested', studioNotified: true });
    expect(await clientEvents(d)).toEqual(['design_change_request']);
  });
});

describe('repeat taps confirm the SAVED decision (AC 55)', () => {
  it('design: A approves, stale B asks for changes and is told "approved"; nothing duplicated', async () => {
    const d = await atFinalApproval('c10-design-repeat');
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' })).toEqual({
      kind: 'approved',
      studioNotified: true,
    });
    const notifiedOnce = await bodyKeyCounts(d);
    expect(await respondToDesignAndNotify(d.token, { action: 'request_design_changes', note: 'Darker' })).toEqual({
      kind: 'approved',
      studioNotified: true,
    });
    expect(await clientEvents(d)).toEqual(['design_approval']);
    expect(await bodyKeyCounts(d)).toEqual(notifiedOnce);

    // The studio moved on: a stale approve answers wrong_state and still shows the approval.
    await forceState(d.engagementId, 'shop_drawings');
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' })).toEqual({
      kind: 'approved',
      studioNotified: true,
    });
    expect(await bodyKeyCounts(d)).toEqual(notifiedOnce);
  });

  it('handover: a second tap after the close answers not_active and still shows "acknowledged"', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c10-handover-repeat');
    await forceState(d.engagementId, 'design_only_handoff');
    expect(await acknowledgeHandoverAndNotify(d.token, {})).toEqual({ kind: 'acknowledged', studioNotified: true });
    await forceState(d.engagementId, 'closed_design_only');
    expect(await acknowledgeHandoverAndNotify(d.token, {})).toEqual({ kind: 'acknowledged', studioNotified: true });
    expect(await clientEvents(d)).toEqual(['handoff_acknowledgement']);
    expect(await bodyKeyCounts(d)).toEqual({ client_handover_acknowledged: 1 });
  });
});

describe('nothing live on file and the step moved on (AC 56)', () => {
  it('design: a retracted approval and a moved delivery read as moved on', async () => {
    const d = await atFinalApproval('c10-design-moved');
    await respondToDesignAndNotify(d.token, { action: 'approve_design' });
    const [approval] = await raw.query<{ id: string }>(
      `select id from public.engagement_events where engagement_id = '${d.engagementId}' and kind = 'design_approval'`,
    );
    await retract(d, approval!.id);
    await forceState(d.engagementId, 'shop_drawings');
    expect(await respondToDesignAndNotify(d.token, { action: 'request_design_changes', note: 'x' })).toEqual({ kind: 'moved_on' });
  });

  it('handover: a retracted confirmation reads as moved on', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c10-handover-moved');
    await forceState(d.engagementId, 'design_only_handoff');
    await acknowledgeHandoverAndNotify(d.token, {});
    const [ack] = await raw.query<{ id: string }>(
      `select id from public.engagement_events where engagement_id = '${d.engagementId}' and kind = 'handoff_acknowledgement'`,
    );
    await retract(d, ack!.id);
    expect(await acknowledgeHandoverAndNotify(d.token, {})).toEqual({ kind: 'moved_on' });
  });

  it('any other refusal is the portal error key', async () => {
    const d = await atFinalApproval('c10-expired');
    await raw.query(`update public.design_engagements set share_expires_at = now() - interval '1 minute' where id = '${d.engagementId}'`);
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' })).toEqual({ kind: 'error', error: 'token_expired' });
  });
});
