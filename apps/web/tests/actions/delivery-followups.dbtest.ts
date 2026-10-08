// Round C, C4, AC 13 and AC 14: the morning follow-up on deliveries that wait on
// the client. Owners and admins only (never the client, never another role), one
// reminder per delivery per ISO week, at most 10 deliveries per org per day.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDeliveryFollowups } from '@/lib/automation/delivery-followups';
import { closeFixture, teardown } from './fixture';
import { deliveryAged, depsAt, followupNotifications, followupOrg, sevenAmCairo } from './delivery-followup-fixture';

const email = vi.hoisted(() => ({ sendDeliveryFollowupEmail: vi.fn() }));
vi.mock('@/lib/email/delivery-senders', () => email);

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => {
  email.sendDeliveryFollowupEmail.mockReset();
  email.sendDeliveryFollowupEmail.mockResolvedValue({ sent: true });
});

describe('runDeliveryFollowups (AC 13, AC 14)', () => {
  it('reminds owners and admins once a week about a delivery waiting past the threshold', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    const waiting = await deliveryAged(org, 'WAIT-6', 6, morning);
    const studioMove = await deliveryAged(org, 'STUDIO-30', 30, morning, 'studio');
    await deliveryAged(org, 'WAIT-2', 2, morning);

    const sixAm = new Date(morning.getTime() - 3_600_000);
    expect((await runDeliveryFollowups(await depsAt(org, sixAm, {}))).ran).toBe(false);
    expect(await followupNotifications(org.orgId)).toEqual([]);

    const first = await runDeliveryFollowups(await depsAt(org, morning, {}));
    expect(first).toEqual({ automation: 'delivery', ran: true, effects: 2, emailsSent: 2, emailsFailed: 0 });
    const notified = await followupNotifications(org.orgId);
    expect(notified.map((row) => row.recipient_user_id).sort()).toEqual([...org.ownerAdminIds].sort());
    expect(notified.every((row) => row.entity_id === waiting && row.params.days === 6)).toBe(true);
    expect(notified[0].params).toMatchObject({ number: expect.any(Number), year: 2026 });
    for (const other of org.otherMemberIds) {
      expect(notified.some((row) => row.recipient_user_id === other)).toBe(false);
    }
    const [mail] = email.sendDeliveryFollowupEmail.mock.calls[0];
    expect(mail).toMatchObject({ deliveriesUrl: 'https://metra.test/en/engagements', locale: 'en' });
    expect(mail.deliveries).toEqual([{ label: expect.stringContaining('Delivery WAIT-6'), days: 6 }]);

    expect((await runDeliveryFollowups(await depsAt(org, morning, {}))).ran).toBe(false);
    const nextDay = await runDeliveryFollowups(await depsAt(org, sevenAmCairo(1), {}));
    expect(nextDay).toMatchObject({ ran: true, effects: 0, emailsSent: 0 });
    expect(await followupNotifications(org.orgId)).toHaveLength(2);

    // A new ISO week: the same delivery again (13 days), and the 2-day one has now waited 9.
    const nextWeek = await runDeliveryFollowups(await depsAt(org, sevenAmCairo(7), {}));
    expect(nextWeek).toMatchObject({ ran: true, effects: 4, emailsSent: 2 });
    const again = (await followupNotifications(org.orgId)).slice(2);
    expect(again.filter((row) => row.entity_id === waiting).map((row) => row.params.days)).toEqual([13, 13]);
    expect(again.some((row) => row.entity_id === studioMove)).toBe(false);
  });

  it('does nothing while follow-ups are off', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    await deliveryAged(org, 'WAIT-9', 9, morning);
    expect(await runDeliveryFollowups(await depsAt(org, morning, { followupEnabled: false }))).toMatchObject({
      ran: false,
      effects: 0,
    });
    expect(await followupNotifications(org.orgId)).toEqual([]);
    expect(email.sendDeliveryFollowupEmail).not.toHaveBeenCalled();
  });

  it('eleven qualifying deliveries: exactly the ten oldest, in one email per owner or admin', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    const byAge = new Map<number, string>();
    for (let age = 6; age <= 16; age += 1) byAge.set(age, await deliveryAged(org, `Q-${age}`, age, morning));

    const run = await runDeliveryFollowups(await depsAt(org, morning, {}));
    expect(run).toMatchObject({ ran: true, effects: 20, emailsSent: 2 });
    const remindedIds = new Set((await followupNotifications(org.orgId)).map((row) => row.entity_id));
    expect(remindedIds).toEqual(new Set([...byAge].filter(([age]) => age >= 7).map(([, id]) => id)));
    expect(email.sendDeliveryFollowupEmail.mock.calls[0][0].deliveries).toHaveLength(10);
  });
});
