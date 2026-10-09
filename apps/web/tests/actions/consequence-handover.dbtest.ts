// Round C, C3, AC 11 and AC 12: the client's handover confirmation closes the
// design-only delivery the studio already chose. The staff path closes inline;
// the hourly closer closes what a client confirmed on their page. The ledger row
// names no one and the audit names the cause.
import { afterAll, describe, expect, it } from 'vitest';
import { runHandoverCloser } from '@/lib/automation/handover-closer';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { recordEventCorrectionCore } from '@/lib/engagements/corrections';
import { executeTransition } from '@/lib/engagements/executor';
import { recordHandoffAndCloseCore } from '@/lib/engagements/handover-close';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { engagementAtBoq, rawEngagement, seedBoqOrg } from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';
import { clientAck, closeRows, closerDeps, engagementOnOwnProject, stateOf } from './handover-fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('the staff path closes inline (AC 11)', () => {
  it("a site engineer recording the client's confirmation closes the delivery, by no one, for a cause", async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    await recordArtifactCore(org.ctx, { engagementId, kind: 'boq' });
    expect((await executeTransition(org.ctx, { engagementId, trigger: 'finalizeBOQ' })).ok).toBe(true);
    await recordPaymentCore(org.ctx, { engagementId, kind: 'balance', amount: '30000' });
    expect((await executeTransition(org.ctx, { engagementId, trigger: 'chooseDesignOnly' })).ok).toBe(true);

    const recorded = await recordHandoffAndCloseCore(org.siteCtx, { engagementId, note: 'Received by hand' });
    expect(recorded).toMatchObject({ ok: true, closed: true });
    const acks = await raw.query(
      `select id from public.engagement_events where engagement_id = '${engagementId}' and kind = 'handoff_acknowledgement'`,
    );
    expect(acks).toHaveLength(1);
    expect(await stateOf(engagementId)).toBe('closed_design_only');
    expect(await closeRows(engagementId)).toEqual([{ actor_user_id: null }]);
    const [audit] = await raw.query<{ after: { state: string; cause: string; recordedBy: string } }>(
      `select after from public.audit_log where entity = 'design_engagement' and entity_id = '${engagementId}'
        order by created_at desc limit 1`,
    );
    // The audit names who recorded the confirmation (F3); the ledger row names no one.
    expect(audit.after).toEqual({ state: 'closed_design_only', cause: 'handoverAcknowledged', recordedBy: org.siteCtx.userId });
  });

  it('recorded in any other state: refused as today, nothing closes', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org, 'boq');
    const recorded = await recordHandoffAndCloseCore(org.siteCtx, { engagementId });
    expect(recorded).toEqual({ ok: false, error: 'handoff_not_open' });
    expect(await stateOf(engagementId)).toBe('boq');
  });
});

describe('the hourly closer (AC 12)', () => {
  it('closes a settled client confirmation only; a fresh, retracted or wrong-state one stays; a second run is a no-op', async () => {
    const org = await seedBoqOrg(orgIds);
    const settled = await engagementOnOwnProject(org, 'design_only_handoff');
    const fresh = await engagementOnOwnProject(org, 'design_only_handoff');
    const retracted = await engagementOnOwnProject(org, 'design_only_handoff');
    const elsewhere = await engagementOnOwnProject(org, 'execution_decision');
    await clientAck(org, settled, 3);
    await clientAck(org, fresh, 1);
    const retractedAck = await clientAck(org, retracted, 30);
    expect(
      (await recordEventCorrectionCore(org.ctx, { engagementId: retracted, eventId: retractedAck, reason: 'Wrong delivery' })).ok,
    ).toBe(true);
    await clientAck(org, elsewhere, 30);

    const deps = await closerDeps(org.orgId);
    expect(await runHandoverCloser(deps)).toEqual({
      automation: 'handover',
      ran: true,
      effects: 1,
      emailsSent: 0,
      emailsFailed: 0,
    });
    expect(await stateOf(settled)).toBe('closed_design_only');
    expect(await closeRows(settled)).toEqual([{ actor_user_id: null }]);
    expect(await stateOf(fresh)).toBe('design_only_handoff');
    expect(await stateOf(retracted)).toBe('design_only_handoff');
    expect(await stateOf(elsewhere)).toBe('execution_decision');

    expect((await runHandoverCloser(deps)).effects).toBe(0);
    expect(await closeRows(settled)).toHaveLength(1);
  });
});
