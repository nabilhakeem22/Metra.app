// Round C fix round: the follow-ups and the digest read every delivery still in
// flight (F1), count the client's wait from when it began rather than from the
// last write (F2), and skip deliveries already reminded this week in the read,
// so overlapping runs stay short (R3).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimPeriod } from '@/lib/automation/claim';
import { weekPeriodKey } from '@/lib/automation/clock';
import { runDeliveryFollowups } from '@/lib/automation/delivery-followups';
import { runPortfolioDigest } from '@/lib/automation/portfolio-digest';
import { withOrgContext } from '@/lib/db/context';
import { mintDeliveryLinkCore, rotateDeliveryLinkCore } from '@/lib/engagements/share';
import { closeFixture, raw, teardown } from './fixture';
import { deliveryAged, depsAt, followupNotifications, followupOrg, sevenAmCairo } from './delivery-followup-fixture';

const email = vi.hoisted(() => ({
  sendDeliveryFollowupEmail: vi.fn(async () => ({ sent: true })),
  sendDigestEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('@/lib/email/delivery-senders', () => ({ sendDeliveryFollowupEmail: email.sendDeliveryFollowupEmail }));
vi.mock('@/lib/email/resend', () => ({ sendDigestEmail: email.sendDigestEmail }));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
beforeEach(() => vi.clearAllMocks());

describe('208 deliveries in flight (F1)', () => {
  it('the digest counts all of them and the follow-ups reach the 3 waiting behind 205 dormant ones', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    for (let i = 0; i < 205; i += 1) await deliveryAged(org, `OLD-${i}`, 30, morning, 'studio');
    const waiting = new Set<string>();
    for (const code of ['W0', 'W1', 'W2']) waiting.add(await deliveryAged(org, code, 9, morning));

    await runPortfolioDigest(await depsAt(org, morning, { digestEnabled: true, digestCadence: 'daily' }));
    const [digest] = await raw.query<{ params: Record<string, number> }>(
      `select params from public.notifications where org_id = '${org.orgId}' and kind = 'portfolio_digest' limit 1`,
    );
    expect(digest.params).toMatchObject({ deliveriesYourMove: 205, deliveriesWaiting: 0, deliveriesStalled: 3 });

    const run = await runDeliveryFollowups(await depsAt(org, morning, {}));
    expect(run).toMatchObject({ ran: true, effects: 6, emailsSent: 2 });
    const notified = await followupNotifications(org.orgId);
    expect(new Set(notified.map((row) => row.entity_id))).toEqual(waiting);
    expect(notified.every((row) => row.params.days === 9)).toBe(true);
  }, 120_000);
});

describe('the wait clock (F2)', () => {
  it('a link minted and rotated by the studio does not restart the wait; the days count from its start', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    const engagementId = await deliveryAged(org, 'WAIT-10', 10, morning);
    expect((await mintDeliveryLinkCore(org.ctx, engagementId)).ok).toBe(true);
    expect((await rotateDeliveryLinkCore(org.ctx, engagementId)).ok).toBe(true);
    const [row] = await raw.query<{ moved: boolean }>(
      `select updated_at > '${morning.toISOString()}'::timestamptz - interval '9 days' as moved
         from public.design_engagements where id = '${engagementId}'`,
    );
    expect(row.moved).toBe(true);

    const run = await runDeliveryFollowups(await depsAt(org, morning, { followupThresholdDays: 6 }));
    expect(run).toMatchObject({ ran: true, effects: 2 });
    expect((await followupNotifications(org.orgId)).map((notification) => notification.params.days)).toEqual([10, 10]);
  });
});

describe('already reminded this week (R3)', () => {
  it('is left out by the read, so the day still reminds 10 others; an overlapping run waits briefly and does nothing', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    const byAge = new Map<number, string>();
    for (let age = 6; age <= 18; age += 1) byAge.set(age, await deliveryAged(org, `R-${age}`, age, morning));
    const week = weekPeriodKey(morning);
    const earlier = [18, 17, 16].map((age) => `${byAge.get(age)}:${week}`);
    await withOrgContext(org.ctx, async (tx) => {
      for (const key of earlier) await claimPeriod(tx, org.orgId, 'delivery-followup', key);
    });

    const [first, second] = await Promise.all([
      runDeliveryFollowups(await depsAt(org, morning, {})),
      runDeliveryFollowups(await depsAt(org, morning, {})),
    ]);
    expect([first.ran, second.ran].sort()).toEqual([false, true]);
    expect(first.effects + second.effects).toBe(20);
    const reminded = new Set((await followupNotifications(org.orgId)).map((row) => row.entity_id));
    expect(reminded).toEqual(new Set([15, 14, 13, 12, 11, 10, 9, 8, 7, 6].map((age) => byAge.get(age))));
  });
});
