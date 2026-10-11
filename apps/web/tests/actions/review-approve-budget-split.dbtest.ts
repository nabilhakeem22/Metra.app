import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ClientAct } from '@/lib/engagements/client-acts/acts';
import { approveDesignWithBudgetAndNotify, respondToDesignAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, snapshotOf, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { consentCounts, issueBand, issuesNamed, pageSeenWithBand } from './round-d-db-fixture';

// Round D, owner decision 2 (AC S1 to S8), through the real writes, read and
// notifier on a real database: approve design + budget is two consents, each
// saved or refused by the seven-argument SQL guard on its OWN issuance.

/** S5's hook: runs once, right after the budget half's notification (between the two writes). */
const between = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>), respondCalls: 0 }));
vi.mock('@/lib/engagements/client-acts/notify', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/engagements/client-acts/notify')>();
  return {
    ...real,
    withStudioNotified: async (token: string, result: { ok: boolean; code?: 'already' }, act: ClientAct | null) => {
      const answer = await real.withStudioNotified(token, result, act);
      const hook = between.hook;
      if (hook && act?.kind === 'budget_acknowledged') {
        between.hook = null;
        await hook();
      }
      return answer;
    },
  };
});
vi.mock('@/lib/engagements/public/respond', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/engagements/public/respond')>();
  return {
    ...real,
    recordDeliveryActionByToken: (...args: Parameters<typeof real.recordDeliveryActionByToken>) => {
      between.respondCalls += 1;
      return real.recordDeliveryActionByToken(...args);
    },
  };
});

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** A delivery at the final approval: renders issued, then the band, both before the page loads. */
async function atFinalApproval(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `now() - interval '2 hours'`);
  await issueBand(d.engagementId, 900000, 1200000, `now() - interval '1 hour'`);
  return d;
}

const pageSeen = (d: RoundBDelivery) => pageSeenWithBand(d.token);
const approve = (d: RoundBDelivery, seen: Awaited<ReturnType<typeof pageSeen>>) =>
  approveDesignWithBudgetAndNotify(d.token, { note: 'Lovely' }, seen);
const NOTHING = { designApprovals: 0, romAcknowledgements: 0, notified: {}, designBudgetParams: [] };

describe('approve design + budget: two consents (S1 to S8)', () => {
  it('S1 nothing changed: both saved, each naming its issuance; two plain notifications', async () => {
    const d = await atFinalApproval('split-s1');
    expect(await approve(d, await pageSeen(d))).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    const both = { client_budget_acknowledged: 1, client_design_approved: 1 };
    expect(await consentCounts(d.engagementId)).toEqual({ designApprovals: 1, romAcknowledgements: 1, notified: both, designBudgetParams: [null] });
    expect(await issuesNamed(d.engagementId)).toEqual({ design: true, rom: true });

    // S6: a double tap answers the same and writes nothing more.
    const before = await consentCounts(d.engagementId);
    expect(await approve(d, await pageSeen(d))).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect(await consentCounts(d.engagementId)).toEqual(before);
  });

  it('S2 only the band changed: the design is saved and says the budget is pending; the budget is asked again', async () => {
    const d = await atFinalApproval('split-s2');
    const seen = await pageSeen(d);
    await issueBand(d.engagementId, 1500000, 2000000);
    expect(await approve(d, seen)).toEqual({ kind: 'approved', studioNotified: true, budget: 'changed' });
    const designOnly = { client_design_approved: 1 };
    expect(await consentCounts(d.engagementId)).toEqual({ ...NOTHING, designApprovals: 1, notified: designOnly, designBudgetParams: ['pending'] });
    const after = (await snapshotOf(d.hash))!;
    expect(after.design_decision).toMatchObject({ kind: 'approved' });
    expect(after.rom_acknowledged_at).toBeNull();
    expect(after.client_actions).toContain('acknowledge_rom');
  });

  it('S3 only the render round changed: the budget is saved alone; the new round is asked again', async () => {
    const d = await atFinalApproval('split-s3');
    const seen = await pageSeen(d);
    await stampRenders(d.engagementId, 'clock_timestamp()');
    expect(await approve(d, seen)).toEqual({ kind: 'changed', budget: 'acknowledged' });
    expect(await consentCounts(d.engagementId)).toEqual({ ...NOTHING, romAcknowledgements: 1, notified: { client_budget_acknowledged: 1 } });
    expect(await issuesNamed(d.engagementId)).toEqual({ design: null, rom: true });
    expect((await snapshotOf(d.hash))!.client_actions).toContain('approve_design');
  });

  it('S4 both changed: nothing saved, nobody notified', async () => {
    const d = await atFinalApproval('split-s4');
    const seen = await pageSeen(d);
    await issueBand(d.engagementId, 1500000, 2000000);
    await stampRenders(d.engagementId, 'clock_timestamp()');
    expect(await approve(d, seen)).toEqual({ kind: 'changed', budget: 'changed' });
    expect(await consentCounts(d.engagementId)).toEqual(NOTHING);
  });

  it('S5 a band re-issued BETWEEN the two writes: the acknowledgement names the band the client saw, and the new one is asked again', async () => {
    const d = await atFinalApproval('split-s5');
    const seen = await pageSeen(d);
    between.hook = () => issueBand(d.engagementId, 1500000, 2000000);
    expect(await approve(d, seen)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    const [ack] = await raw.query<{ names_seen: boolean; names_current: boolean }>(
      `select e.acknowledged_issue_at = '${seen.romIssuedAt}'::timestamptz as names_seen,
              e.acknowledged_issue_at = de.rom_issued_at as names_current
         from public.engagement_events e join public.design_engagements de on de.id = e.engagement_id
        where e.engagement_id = '${d.engagementId}' and e.kind = 'rom_acknowledgement'`,
    );
    expect(ack).toEqual({ names_seen: true, names_current: false });
    const after = (await snapshotOf(d.hash))!;
    expect(after.rom_acknowledged_at).toBeNull();
    expect(after.client_actions).toContain('acknowledge_rom');
    expect(after.design_decision).toMatchObject({ kind: 'approved' });
  });

  it('S7 an expired link: an error after ONE call, nothing written', async () => {
    const d = await atFinalApproval('split-s7');
    const seen = await pageSeen(d);
    await raw.query(`update public.design_engagements set share_expires_at = now() - interval '1 minute' where id = '${d.engagementId}'`);
    between.respondCalls = 0;
    expect(await approve(d, seen)).toEqual({ kind: 'error', error: 'token_expired' });
    expect(between.respondCalls).toBe(1);
    expect(await consentCounts(d.engagementId)).toEqual(NOTHING);
  });

  it('S8 a stale tab after the delivery moved on: the approval on file, the budget when the band is the same', async () => {
    const d = await atFinalApproval('split-s8');
    const seen = await pageSeen(d);
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, seen)).toMatchObject({ kind: 'approved' });
    await forceState(d.engagementId, 'boq');
    expect(await approve(d, seen)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect((await consentCounts(d.engagementId)).romAcknowledgements).toBe(1);

    const rebanded = await atFinalApproval('split-s8-reband');
    const stale = await pageSeen(rebanded);
    expect(await respondToDesignAndNotify(rebanded.token, { action: 'approve_design' }, stale)).toMatchObject({ kind: 'approved' });
    await forceState(rebanded.engagementId, 'boq');
    await issueBand(rebanded.engagementId, 1500000, 2000000);
    expect(await approve(rebanded, stale)).toEqual({ kind: 'approved', studioNotified: true, budget: 'changed' });
    expect((await consentCounts(rebanded.engagementId)).romAcknowledgements).toBe(0);
  });
});
