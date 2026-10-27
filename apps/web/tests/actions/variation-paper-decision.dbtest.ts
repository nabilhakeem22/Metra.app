import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { decideWithCode, requestCode, seedHome, type Home } from './client-home-fixture';
import { appQuery, closeExecutionFixture, ownerQuery, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// 0065, H7.3 ruling: variation_order_events.recorded_on_paper marks a client's
// change-order decision that the studio recorded from a paper document. Such
// an event is the studio's write (actor_channel 'staff'), but the decision is
// the client's, so app_variation_by_token's `rejection_channel` reads a paper
// rejection as 'client'. The termination cascade's rejection stays 'staff', and
// every event today's code writes, which never names the column, takes its
// default false and reads as before.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  owner = ctxFor(orgId, ownerId, 'owner');
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** A signed home contract with one change order issued to the client. */
async function issuedOrder(): Promise<Home & { orderId: string; tokenHash: string }> {
  const home = await seedHome(orgId, 'signed');
  const tokenHash = `${randomUUID()}-paper`;
  const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash });
  return { ...home, orderId: order.id, tokenHash };
}

const rejectionChannelOf = async (tokenHash: string) =>
  (await ownerQuery<{ channel: string | null }>(
    `select public.app_variation_by_token($1) ->> 'rejection_channel' as channel`,
    [tokenHash],
  ))[0].channel;

const rejectionsOf = (orderId: string) =>
  ownerQuery<{ actor_channel: string | null; recorded_on_paper: boolean }>(
    `select actor_channel, recorded_on_paper from public.variation_order_events where variation_order_id = $1 and kind = 'rejected'`,
    [orderId],
  );

describe('rejection_channel follows recorded_on_paper', () => {
  it('a rejection the studio recorded from the client\'s paper reads as the client\'s; metra_app may write the column', async () => {
    const order = await issuedOrder();
    await ownerQuery(`update public.variation_orders set status = 'rejected' where id = $1`, [order.orderId]);
    await appQuery(
      orgId,
      ownerId,
      `insert into public.variation_order_events
         (org_id, variation_order_id, kind, actor_user_id, actor_channel, from_status, to_status, recorded_on_paper)
       values ($1, $2, 'rejected', $3, 'staff', 'issued', 'rejected', true)`,
      [orgId, order.orderId, ownerId],
    );
    expect(await rejectionsOf(order.orderId)).toEqual([{ actor_channel: 'staff', recorded_on_paper: true }]);
    expect(await rejectionChannelOf(order.tokenHash)).toBe('client');
  });

  it('the termination cascade\'s rejection still reads as the studio\'s, the column at its default', async () => {
    const order = await issuedOrder();
    expect((await terminateContractCore(owner, { id: order.contract.contractId })).ok).toBe(true);
    expect(await rejectionsOf(order.orderId)).toEqual([{ actor_channel: 'staff', recorded_on_paper: false }]);
    expect(await rejectionChannelOf(order.tokenHash)).toBe('staff');
  });

  it('today\'s writers never name the column: the client\'s own online rejection is false and reads as the client\'s', async () => {
    const order = await issuedOrder();
    const code = await requestCode(order.delivery.tokenHash, 'decide_variation', order.orderId);
    expect(await decideWithCode(order.delivery.tokenHash, order.orderId, 'reject', code.code)).toEqual({ code: 'ok' });
    expect(await rejectionsOf(order.orderId)).toEqual([{ actor_channel: 'client', recorded_on_paper: false }]);
    expect(await rejectionChannelOf(order.tokenHash)).toBe('client');
  });
});
