// Round C, C4, AC 15: the digest counts the deliveries by the same status the
// deliveries list shows (deliveryStatusAsOf), in its notification and its email.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runPortfolioDigest } from '@/lib/automation/portfolio-digest';
import { closeFixture, raw, teardown } from './fixture';
import { deliveryAged, depsAt, followupOrg, sevenAmCairo } from './delivery-followup-fixture';

const email = vi.hoisted(() => ({ sendDigestEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/email/resend', () => email);

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('the digest counts deliveries (AC 15)', () => {
  it('your move, waiting on the client and stalled, as the deliveries list counts them', async () => {
    const org = await followupOrg(orgIds);
    const morning = sevenAmCairo();
    await deliveryAged(org, 'STUDIO-1', 1, morning, 'studio');
    await deliveryAged(org, 'STUDIO-40', 40, morning, 'studio');
    await deliveryAged(org, 'WAIT-3', 3, morning);
    await deliveryAged(org, 'STALL-7', 7, morning);
    await deliveryAged(org, 'STALL-20', 20, morning);

    const run = await runPortfolioDigest(
      await depsAt(org, morning, { digestEnabled: true, digestCadence: 'daily' }),
    );
    expect(run).toMatchObject({ ran: true, effects: 2, emailsSent: 2 });
    const rows = await raw.query<{ params: Record<string, number> }>(
      `select params from public.notifications where org_id = '${org.orgId}' and kind = 'portfolio_digest'`,
    );
    expect(rows).toHaveLength(2);
    for (const { params } of rows) {
      expect(params).toMatchObject({ deliveriesYourMove: 2, deliveriesWaiting: 1, deliveriesStalled: 2 });
    }
    expect(email.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ deliveriesYourMove: 2, deliveriesWaiting: 1, deliveriesStalled: 2 }),
    );
  });
});
