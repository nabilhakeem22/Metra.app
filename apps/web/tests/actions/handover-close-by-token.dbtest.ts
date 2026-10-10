// Round C, C11 (AC 57): the client's handover confirmation closes the
// design-only delivery INSIDE THE SAME REQUEST, through the executor as the
// org's system actor (ledger row by no one, audit naming the cause). When the
// close fails, the confirmation still stands and the hourly closer closes it;
// a repeat tap repairs it too.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { runHandoverCloser } from '@/lib/automation/handover-closer';
import { HANDOVER_CLOSE_WAIT_MS, closeHandoverByToken, withHandoverClose } from '@/lib/engagements/client-acts/handover-close';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { closeAudit, closeRows, closerDeps, stateOf } from './handover-fixture';
import { forceState, seedRoundBDelivery } from './round-b-fixture';

const failing = vi.hoisted(() => ({ systemActor: false }));

// The one seam the test forces: no system actor to close as (an org with no
// owner or admin left). Everything else is the real code on the real database.
vi.mock('@/lib/automation/system-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/automation/system-context')>();
  return {
    resolveSystemContext: async (orgId: string): Promise<OrgContext | null> =>
      failing.systemActor ? null : real.resolveSystemContext(orgId),
  };
});

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  failing.systemActor = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function atHandover(suffix: string) {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'design_only_handoff');
  return d;
}

/** The portal's own path: the token write, then the close that follows it. */
async function confirmHandover(token: string) {
  const result = await recordDeliveryActionByToken(token, { action: 'acknowledge_handoff' });
  return withHandoverClose(token, 'acknowledge_handoff', result, async () => result);
}

describe('withHandoverClose (AC 57)', () => {
  it("closes the delivery in the same request: ledger by no one, audit by the cause, 'client' as recorder", async () => {
    const d = await atHandover('close-inline');
    expect(await confirmHandover(d.token)).toEqual({ ok: true });
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
    expect(await closeRows(d.engagementId)).toEqual([{ actor_user_id: null }]);
    expect((await closeAudit(d.engagementId)).after).toEqual({
      state: 'closed_design_only',
      cause: 'handoverAcknowledged',
      recordedBy: 'client',
    });
    // A second tap after the close is the portal's ordinary refusal; nothing else moves.
    const again = await confirmHandover(d.token);
    expect(again.ok).toBe(false);
    expect(await closeRows(d.engagementId)).toHaveLength(1);
  });

  it('with the close failing, the confirmation stands and the hourly closer closes it', async () => {
    const d = await atHandover('close-fails');
    failing.systemActor = true;
    expect(await confirmHandover(d.token)).toEqual({ ok: true });
    expect(await stateOf(d.engagementId)).toBe('design_only_handoff');
    const acks = await raw.query(
      `select id from public.engagement_events
        where engagement_id = '${d.engagementId}' and kind = 'handoff_acknowledgement' and actor_channel = 'client'`,
    );
    expect(acks).toHaveLength(1);

    failing.systemActor = false;
    const later = new Date(Date.now() + 3 * 60 * 1000);
    expect((await runHandoverCloser(await closerDeps(d.orgId, later))).effects).toBe(1);
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
    expect(await closeRows(d.engagementId)).toEqual([{ actor_user_id: null }]);
  });

  it('a repeat tap (already) repairs a close that failed', async () => {
    const d = await atHandover('close-repair');
    failing.systemActor = true;
    await confirmHandover(d.token);
    failing.systemActor = false;
    expect(await confirmHandover(d.token)).toEqual({ ok: true, code: 'already' });
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
    expect(await closeRows(d.engagementId)).toHaveLength(1);
  });

  it('closes nothing for any other verb, a refusal, an unknown token or a retracted confirmation', async () => {
    const d = await atHandover('close-none');
    const answer = async () => 'notified';
    expect(await withHandoverClose(d.token, 'acknowledge_rom', { ok: true }, answer)).toBe('notified');
    expect(await withHandoverClose(d.token, 'acknowledge_handoff', { ok: false }, answer)).toBe('notified');
    expect(await stateOf(d.engagementId)).toBe('design_only_handoff');
    expect(await closeHandoverByToken('not-a-token')).toBe(false);
    expect(await closeHandoverByToken('   ')).toBe(false);

    // A live link but no live client acknowledgement: nothing to close.
    expect(await closeHandoverByToken(d.token)).toBe(false);
    const [ack] = await raw.query<{ id: string }>(
      `insert into public.engagement_events (org_id, engagement_id, kind, actor_channel, actor_name)
       values ('${d.orgId}', '${d.engagementId}', 'handoff_acknowledgement', 'client', 'Mona') returning id`,
    );
    await raw.query(
      `insert into public.engagement_events (org_id, engagement_id, kind, actor_channel, actor_user_id, supersedes_event_id)
       values ('${d.orgId}', '${d.engagementId}', 'event_correction', 'staff', '${d.ownerId}', '${ack.id}')`,
    );
    expect(await closeHandoverByToken(d.token)).toBe(false);
    expect(await stateOf(d.engagementId)).toBe('design_only_handoff');
    expect(await closeRows(d.engagementId)).toEqual([]);
  });
});

describe('withHandoverClose: the answer waits for the slower of notify and close, capped (F7)', () => {
  it('runs the notification alongside the close, not after it', async () => {
    const d = await atHandover('close-parallel');
    await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' });
    let closedWhenNotifyStarted: string | null = null;
    await withHandoverClose(d.token, 'acknowledge_handoff', { ok: true }, async () => {
      closedWhenNotifyStarted = await stateOf(d.engagementId);
      return null;
    });
    // The notification began before the close finished; the close still landed before the answer.
    expect(closedWhenNotifyStarted).toBe('design_only_handoff');
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
  });

  it(`answers within ${HANDOVER_CLOSE_WAIT_MS} ms of a slow notification, and the close still lands`, async () => {
    const d = await atHandover('close-capped');
    await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' });
    const started = Date.now();
    await withHandoverClose(d.token, 'acknowledge_handoff', { ok: true }, async () => 'notified');
    expect(Date.now() - started).toBeLessThan(HANDOVER_CLOSE_WAIT_MS + 500);
    expect(await stateOf(d.engagementId)).toBe('closed_design_only');
  });
});
