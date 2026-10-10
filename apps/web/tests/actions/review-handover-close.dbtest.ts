import { afterAll, describe, expect, it } from 'vitest';
import { acknowledgeHandoverAndNotify } from '@/lib/engagements/client-acts/handover-acts';
import { closeFixture, raw, teardown } from './fixture';
import { stateOf } from './handover-fixture';
import { forceState, seedRoundBDelivery } from './round-b-fixture';

// C10 x C11 (AC 57) through the typed portal act: the client's handover
// confirmation closes the delivery in the same request, ledger actor null; a
// repeat tap after a close that did not happen repairs it.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('the handover act closes the delivery (AC 57)', () => {
  it('a first confirmation closes it; the answer is still "acknowledged"', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c10-c11-close');
    await forceState(d.engagementId, 'design_only_handoff');
    expect(await acknowledgeHandoverAndNotify(d.token, {})).toEqual({ kind: 'acknowledged', studioNotified: true });
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
    const [ledger] = await raw.query<{ actor_user_id: string | null }>(
      `select actor_user_id from public.engagement_transitions
        where engagement_id = '${d.engagementId}' and trigger = 'recipientAcknowledges'`,
    );
    expect(ledger!.actor_user_id).toBeNull();
  });

  it('a repeat tap repairs a close that did not happen', async () => {
    const d = await seedRoundBDelivery(orgIds, 'c10-c11-repair');
    await forceState(d.engagementId, 'design_only_handoff');
    // The first tap's write without the close (as if the close had failed).
    await raw.query(
      `insert into public.engagement_events (org_id, engagement_id, kind, actor_channel)
       values ('${d.orgId}', '${d.engagementId}', 'handoff_acknowledgement', 'client')`,
    );
    expect(await stateOf(d.engagementId)).toBe('design_only_handoff');
    expect(await acknowledgeHandoverAndNotify(d.token, {})).toMatchObject({ kind: 'acknowledged' });
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
  });
});
