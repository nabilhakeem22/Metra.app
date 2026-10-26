import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken } from '@/lib/share/token';
import { recordVariationDecisionOnPaperCore } from '@/lib/variations/core';
import { respondToVariationByToken } from '@/lib/variations/public';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// H7.3: a decision recorded on paper and the client's own decision online can
// meet. Both take the contract FOR SHARE and then the change order, in that
// order, and both flip it only while it is issued: exactly one decision lands,
// with exactly one event, and the other side gets a clean answer (online
// `already_responded`, on paper `variation_not_issued`), never an error.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let admin: OrgContext;
const TODAY = todayInCairo(new Date());

/** The client's decision, held open on its own connection. */
const client = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }] });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  admin = ctxFor(orgId, seeded.memberIds[0], 'admin');
});

afterAll(async () => {
  await client.end();
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const statusOf = async (id: string) =>
  (await ownerQuery<{ status: string }>(`select status::text from public.variation_orders where id = $1`, [id]))[0].status;

const decisionsOf = (id: string) =>
  ownerQuery<{ kind: string; channel: string; paper: boolean }>(
    `select kind, actor_channel as channel, recorded_on_paper as paper from public.variation_order_events
      where variation_order_id = $1 and kind in ('approved', 'rejected')`,
    [id],
  );

async function issuedOrder() {
  const contract = await seedExecutionContract(orgId, { state: 'signed' });
  const token = mintShareToken();
  const order = await seedVariation(orgId, contract, 'issued', { tokenHash: token.hash });
  return { contract, order, rawToken: token.raw };
}

describe('paper decision versus the client deciding online', () => {
  it('a client decision in flight: the paper record waits for it, then answers variation_not_issued', async () => {
    const { contract, order } = await issuedOrder();
    let flipped!: () => void;
    const orderHeld = new Promise<void>((done) => (flipped = done));
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    // The client function's order: the contract FOR SHARE, then the flip and its event.
    const online = client.begin(async (tx) => {
      await tx`select id from public.contracts where id = ${contract.contractId} for share`;
      await tx`update public.variation_orders set status = 'rejected', updated_at = now()
                where id = ${order.id} and status = 'issued'`;
      await tx`insert into public.variation_order_events
                 (org_id, variation_order_id, kind, actor_channel, from_status, to_status)
               values (${orgId}, ${order.id}, 'rejected', 'client', 'issued', 'rejected')`;
      flipped();
      await released;
    });
    await orderHeld;

    let settled = false;
    const paper = recordVariationDecisionOnPaperCore(owner, {
      variationOrderId: order.id,
      decision: 'approve',
      decidedOn: TODAY,
    }).finally(() => {
      settled = true;
    });
    try {
      await new Promise((done) => setTimeout(done, 400));
      // The paper record shares the contract lock and waits on the order row.
      expect(settled).toBe(false);
    } finally {
      release();
      await online;
    }

    expect(await paper).toEqual({ ok: false, error: 'variation_not_issued' });
    expect(await statusOf(order.id)).toBe('rejected');
    expect(await decisionsOf(order.id)).toEqual([{ kind: 'rejected', channel: 'client', paper: false }]);
  });

  it('a decision recorded on paper first: the client then answers already_responded', async () => {
    const { order, rawToken } = await issuedOrder();
    expect(
      await recordVariationDecisionOnPaperCore(owner, { variationOrderId: order.id, decision: 'reject', decidedOn: TODAY }),
    ).toMatchObject({ ok: true });
    expect(await respondToVariationByToken(rawToken, { decision: 'approve', actorName: 'Client' })).toEqual({
      ok: false,
      error: 'already_responded',
    });
    expect(await statusOf(order.id)).toBe('rejected');
    expect(await decisionsOf(order.id)).toEqual([{ kind: 'rejected', channel: 'staff', paper: true }]);
  });

  it('both at the same moment, again and again: exactly one decision and one event, the loser answered cleanly', async () => {
    const winners = new Set<string>();
    for (let round = 0; round < 12; round += 1) {
      const { order, rawToken } = await issuedOrder();
      // The paper core makes more round trips before its lock than the client's
      // one call, so the client is held back a little in some rounds and each
      // side wins some of them.
      const [paper, online] = await Promise.all([
        recordVariationDecisionOnPaperCore(owner, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
        new Promise((done) => setTimeout(done, (round % 4) * 15)).then(() =>
          respondToVariationByToken(rawToken, { decision: 'reject', actorName: 'Client' }),
        ),
      ]);
      winners.add(paper.ok ? 'paper' : 'online');
      const decisions = await decisionsOf(order.id);
      expect(decisions, `round ${String(round)}`).toHaveLength(1);
      if (paper.ok) {
        expect(online).toEqual({ ok: false, error: 'already_responded' });
        expect(await statusOf(order.id)).toBe('approved');
        expect(decisions[0]).toEqual({ kind: 'approved', channel: 'staff', paper: true });
      } else {
        expect(paper).toEqual({ ok: false, error: 'variation_not_issued' });
        expect(online).toEqual({ ok: true });
        expect(await statusOf(order.id)).toBe('rejected');
        expect(decisions[0]).toEqual({ kind: 'rejected', channel: 'client', paper: false });
      }
    }
    expect([...winners].sort()).toEqual(['online', 'paper']);
  });

  it('two studio members recording at once: one lands, the other answers variation_not_issued', async () => {
    const { order } = await issuedOrder();
    const results = await Promise.all([
      recordVariationDecisionOnPaperCore(owner, { variationOrderId: order.id, decision: 'approve', decidedOn: TODAY }),
      recordVariationDecisionOnPaperCore(admin, { variationOrderId: order.id, decision: 'reject', decidedOn: TODAY }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: 'variation_not_issued' });
    expect(await decisionsOf(order.id)).toHaveLength(1);
  });
});
