import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { seedRoundBDelivery, snapshotOf } from './round-b-fixture';

// Round D, PR-D2 fix round (security L1): the snapshot's receipts stop at the
// newest 200, and receipts_truncated says when there were more, so a studio
// member recording many tiny payments cannot make one client page as large as
// they like. A real delivery has a handful.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** A delivery with `count` payments of 1, 2, ... `count` EGP, the larger the older. */
async function withPayments(count: number) {
  const d = await seedRoundBDelivery(orgIds, `receipts-${count}`);
  await raw.query(
    `insert into public.payment_events (org_id, engagement_id, kind, amount, recorded_by, cleared_at)
     select '${d.orgId}', '${d.engagementId}', 'deposit', n, '${d.ownerId}', now() - n * interval '1 minute'
       from generate_series(1, ${count}) as n`,
  );
  const snapshot = (await snapshotOf(d.hash))!;
  return {
    amounts: (snapshot.receipts as Array<{ amount: string }>).map((receipt) => receipt.amount),
    truncated: snapshot.receipts_truncated,
  };
}

const newest = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1}.0000`);

describe('receipts are capped at 200 (L1)', () => {
  it('199 payments: all of them, not truncated', async () => {
    expect(await withPayments(199)).toEqual({ amounts: newest(199), truncated: false });
  });

  it('200 payments: all of them, not truncated', async () => {
    expect(await withPayments(200)).toEqual({ amounts: newest(200), truncated: false });
  });

  it('201 payments: the newest 200, and truncated', async () => {
    expect(await withPayments(201)).toEqual({ amounts: newest(200), truncated: true });
  });

  it('no payments: an empty list, not truncated', async () => {
    expect(await withPayments(0)).toEqual({ amounts: [], truncated: false });
  });
});
