// Round C, C11 (AC 58): the hourly sweep repairs a studio notification a
// client's first tap lost, in the org's RLS transaction as its owner/admin
// system actor, then emails each member with a NEW notification exactly as a
// first tap would. One claim per Cairo hour; the next hour finds nothing.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cairoHourKey } from '@/lib/automation/clock';
import { runHandoverCloser } from '@/lib/automation/handover-closer';
import { runLostNotificationSweep } from '@/lib/automation/lost-notifications';
import type { AutomationDeps } from '@/lib/automation/types';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import { closerDeps } from './handover-fixture';
import { seedRoundBDelivery } from './round-b-fixture';
import { notificationsOf, plantClaim, plantEvent } from './round-c-db-fixture';

const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string; act: unknown; deliveryUrl: string }> }));

vi.mock('@/lib/email/delivery-senders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/delivery-senders')>()),
  sendClientActEmail: async (input: { to: string; act: unknown; deliveryUrl: string }) => {
    sent.emails.push({ to: input.to, act: input.act, deliveryUrl: input.deliveryUrl });
    return { sent: true };
  },
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  sent.emails = [];
});

const LOST = `now() - interval '30 minutes'`;

/** The runner's deps at `now`, with every member's address `<user id>@studio.test`. */
async function depsAt(orgId: string, now: Date): Promise<AutomationDeps> {
  return {
    ...(await closerDeps(orgId, now)),
    lookupRecipientEmail: async (userId: string) => ({ status: 'found', email: `${userId}@studio.test` }),
  };
}

const roles = [{ role: 'project_manager' }, { role: 'accountant' }, { role: 'viewer' }] as const;

describe('runLostNotificationSweep (AC 58)', () => {
  it('notifies a lost act once and emails each new recipient; the same hour and the next find nothing', async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-handover', [...roles]);
    const [pm] = d.memberIds;
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const now = new Date();

    const first = await runLostNotificationSweep(await depsAt(d.orgId, now));
    expect(first).toEqual({ automation: 'notify', ran: true, effects: 1, emailsSent: 2, emailsFailed: 0 });
    const rows = await notificationsOf(d.engagementId);
    expect(new Set(rows.map((row) => row.recipient_user_id))).toEqual(new Set([d.ownerId, pm]));
    expect(rows.every((row) => row.body_key === 'client_handover_acknowledged' && row.count === 1)).toBe(true);
    expect(sent.emails.map((email) => email.to).sort()).toEqual([`${d.ownerId}@studio.test`, `${pm}@studio.test`].sort());
    expect(sent.emails[0]).toMatchObject({
      act: { kind: 'handover_acknowledged' },
      deliveryUrl: `https://metra.test/ar-EG/engagements/${d.engagementId}`,
    });

    const sameHour = await runLostNotificationSweep(await depsAt(d.orgId, now));
    expect(sameHour).toMatchObject({ ran: false, effects: 0, emailsSent: 0 });
    const claims = await raw.query<{ period_key: string }>(
      `select period_key from public.automation_run_log where org_id = '${d.orgId}' and automation_key = 'notify'`,
    );
    expect(claims).toEqual([{ period_key: cairoHourKey(now) }]);

    // The next hour: its claim is free again. (The database's clock cannot be
    // moved, and the function refuses a window that ends in the future, so the
    // next hour is the same instant with this hour's claim released.)
    await raw.query(`delete from public.automation_run_log where org_id = '${d.orgId}' and automation_key = 'notify'`);
    const nextHour = await runLostNotificationSweep(await depsAt(d.orgId, now));
    // The probe sees every act answered: no sweep, no claim.
    expect(nextHour).toEqual({ automation: 'notify', ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 });
    expect(await notificationsOf(d.engagementId)).toHaveLength(2);
    expect(sent.emails).toHaveLength(2);
  });

  it('a lost payment claim reaches the finance roles only, and its email names the milestone', async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-claim', [...roles]);
    const [pm, accountant, viewer] = d.memberIds;
    await plantClaim(d, 'deposit', LOST);
    const result = await runLostNotificationSweep(await depsAt(d.orgId, new Date()));
    expect(result).toMatchObject({ ran: true, effects: 1, emailsSent: 2 });
    const recipients = (await notificationsOf(d.engagementId)).map((row) => row.recipient_user_id);
    expect(new Set(recipients)).toEqual(new Set([d.ownerId, accountant]));
    expect(recipients).not.toContain(pm);
    expect(recipients).not.toContain(viewer);
    expect(sent.emails.every((email) => (email.act as { milestoneKind?: string }).milestoneKind === 'deposit')).toBe(true);
  });

  it('nothing lost: the probe answers, nothing is claimed, written or sent (F5)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-none', [...roles]);
    // A client act the first tap DID notify: answered, so not lost.
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    await notifyAsFirstTap(d.hash, 'client_handover_acknowledged');
    expect(await runLostNotificationSweep(await depsAt(d.orgId, new Date()))).toEqual({
      automation: 'notify',
      ran: false,
      effects: 0,
      emailsSent: 0,
      emailsFailed: 0,
    });
    expect(await claimsOf(d.orgId)).toEqual([]);
    expect(sent.emails).toEqual([]);
  });

  it('rides the handover closer: with its probe answered there, an idle org costs the sweep no transaction', async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-ride', [...roles]);
    const deps = await depsAt(d.orgId, new Date());
    await runHandoverCloser(deps);
    expect(await deps.memo.lostActsPossible).toBe(false);
    expect(await runLostNotificationSweep(deps)).toMatchObject({ ran: false });
    expect(await claimsOf(d.orgId)).toEqual([]);
  });

  it("the probe is not fooled by a LATER notification of another act on the same delivery", async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-other-key', [...roles]);
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    // A different act, notified after the lost one.
    await plantEvent(d, { kind: 'rom_acknowledgement', at: `now() - interval '15 minutes'` });
    await notifyAsFirstTap(d.hash, 'client_budget_acknowledged');
    const deps = await depsAt(d.orgId, new Date());
    await runHandoverCloser(deps);
    expect(await deps.memo.lostActsPossible).toBe(true);
    const result = await runLostNotificationSweep(deps);
    expect(result).toMatchObject({ ran: true, effects: 1 });
    expect((await notificationsOf(d.engagementId)).map((row) => row.body_key)).toContain('client_handover_acknowledged');
  });

  it('an actor the function refuses (not owner or admin) sweeps nothing and says so', async () => {
    const d = await seedRoundBDelivery(orgIds, 'lost-refused', [...roles]);
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = { ...(await depsAt(d.orgId, new Date())), ctx: ctxFor(d.orgId, d.memberIds[0], 'project_manager') };
    expect(await runLostNotificationSweep(deps)).toMatchObject({ ran: false, effects: 0, emailsSent: 0 });
    expect(warn).toHaveBeenCalledWith('lost notification sweep refused', { org: d.orgId });
    expect(await notificationsOf(d.engagementId)).toEqual([]);
    // The refusal rolled the hour's claim back: the real actor can still sweep this hour.
    expect(await claimsOf(d.orgId)).toEqual([]);
    warn.mockRestore();
  });
});

/** The hour claims the sweep holds for this org. */
async function claimsOf(orgId: string) {
  return raw.query<{ period_key: string }>(
    `select period_key from public.automation_run_log where org_id = '${orgId}' and automation_key = 'notify'`,
  );
}

/** What a first tap's notify does: every owner (the role every act reaches) gets the row now. */
async function notifyAsFirstTap(hash: string, bodyKey: string): Promise<void> {
  await raw.query(
    `select public.app_delivery_notify_studio_by_token('${hash}', '${bodyKey}', '{}'::jsonb, '["owner","admin"]'::jsonb)`,
  );
}
