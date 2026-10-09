// Round C fix round, the handover close:
//  F3/S1  the close's audit names who confirmed it (the recorder, or 'client');
//         the ledger row still names no one.
//  F4     two members recording at once leave ONE acknowledgement and both are
//         told the truth (closed).
//  R4     a workspace whose design flow is off is skipped quietly by the closer.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runHandoverCloser } from '@/lib/automation/handover-closer';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { executeTransition } from '@/lib/engagements/executor';
import { recordHandoffAndCloseCore } from '@/lib/engagements/handover-close';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { engagementAtBoq, seedBoqOrg, type BoqOrg } from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';
import { clientAck, closeAudit, closeRows, closerDeps, engagementOnOwnProject, staffAck, stateOf } from './handover-fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** A real delivery walked to `design_only_handoff`. */
async function atHandoff(org: BoqOrg): Promise<string> {
  const engagementId = await engagementAtBoq(org);
  await recordArtifactCore(org.ctx, { engagementId, kind: 'boq' });
  expect((await executeTransition(org.ctx, { engagementId, trigger: 'finalizeBOQ' })).ok).toBe(true);
  await recordPaymentCore(org.ctx, { engagementId, kind: 'balance', amount: '30000' });
  expect((await executeTransition(org.ctx, { engagementId, trigger: 'chooseDesignOnly' })).ok).toBe(true);
  return engagementId;
}

describe('two members record the confirmation at the same moment (F4)', () => {
  it('one acknowledgement row, one close, and both are told it closed', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await atHandoff(org);
    const results = await Promise.all([
      recordHandoffAndCloseCore(org.ctx, { engagementId }),
      recordHandoffAndCloseCore(org.pmCtx, { engagementId }),
    ]);
    expect(results.map((result) => ({ ok: result.ok, closed: result.closed }))).toEqual([
      { ok: true, closed: true },
      { ok: true, closed: true },
    ]);
    const acks = await raw.query(
      `select id from public.engagement_events where engagement_id = '${engagementId}' and kind = 'handoff_acknowledgement'`,
    );
    expect(acks).toHaveLength(1);
    expect(await stateOf(engagementId)).toBe('closed_design_only');
    expect(await closeRows(engagementId)).toEqual([{ actor_user_id: null }]);
  });
});

describe('who may record the confirmation (owner decision, Oct 9)', () => {
  it('a site engineer or viewer is refused before anything is written; the delivery stays open; a PM closes it', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await atHandoff(org);
    for (const ctx of [org.siteCtx, org.viewerCtx]) {
      expect(await recordHandoffAndCloseCore(ctx, { engagementId, note: 'Received' })).toEqual({ ok: false, error: 'forbidden' });
    }
    const written = await raw.query(
      `select id from public.engagement_events where engagement_id = '${engagementId}' and kind = 'handoff_acknowledgement'`,
    );
    expect(written).toEqual([]);
    expect(await stateOf(engagementId)).toBe('design_only_handoff');
    expect(await recordHandoffAndCloseCore(org.pmCtx, { engagementId })).toMatchObject({ ok: true, closed: true });
    expect(await stateOf(engagementId)).toBe('closed_design_only');
  });
});

describe('the hourly closer names who confirmed (F3, S1)', () => {
  it("the client's own confirmation reads 'client'; one the studio recorded names the recorder", async () => {
    const org = await seedBoqOrg(orgIds);
    const byClient = await engagementOnOwnProject(org, 'design_only_handoff');
    const byStaff = await engagementOnOwnProject(org, 'design_only_handoff');
    await clientAck(org, byClient, 5);
    await staffAck(org, byStaff, org.pmCtx.userId, 5);
    expect((await runHandoverCloser(await closerDeps(org.orgId))).effects).toBe(2);
    expect((await closeAudit(byClient)).after).toEqual({
      state: 'closed_design_only',
      cause: 'handoverAcknowledged',
      recordedBy: 'client',
    });
    expect((await closeAudit(byStaff)).after.recordedBy).toBe(org.pmCtx.userId);
    expect(await closeRows(byStaff)).toEqual([{ actor_user_id: null }]);
  });
});

describe('a workspace whose design flow is off (R4)', () => {
  it('is skipped quietly, every hour, and closes once the flow is back', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementOnOwnProject(org, 'design_only_handoff');
    await clientAck(org, engagementId, 5);
    await raw.query(`update public.workspace_entitlements set enabled_flows = '{}' where org_id = '${org.orgId}'`);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let hour = 0; hour < 2; hour += 1) {
        expect((await runHandoverCloser(await closerDeps(org.orgId))).effects).toBe(0);
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
    expect(await stateOf(engagementId)).toBe('design_only_handoff');
    await raw.query(`update public.workspace_entitlements set enabled_flows = '{interior}' where org_id = '${org.orgId}'`);
    expect((await runHandoverCloser(await closerDeps(org.orgId))).effects).toBe(1);
  });
});
