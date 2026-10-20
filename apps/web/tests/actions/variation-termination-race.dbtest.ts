import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintShareToken } from '@/lib/share/token';
import { respondToVariationByToken } from '@/lib/variations/public';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// DB step B addendum (A5 reliability, /v versus termination): the client's
// approval on /v and the studio's termination of the contract are serialised
// on the CONTRACT row. Termination holds it FOR UPDATE and rejects the open
// change orders in the same transaction; app_variation_respond_by_token takes
// it FOR SHARE before it touches the order and reads its status again. So an
// approval that arrives while a termination is in flight waits for it and
// answers `contract_inactive`: no change order is ever approved on a contract
// that is gone.

const orgIds: string[] = [];
let orgId: string;

/** The studio's termination, held open on its own connection. */
const studio = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  orgIds.push(orgId);
});

afterAll(async () => {
  await studio.end();
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const statusOf = async (table: 'contracts' | 'variation_orders', id: string) =>
  (await ownerQuery<{ status: string }>(`select status::text from public.${table} where id = $1`, [id]))[0].status;

describe('/v approve versus termination', () => {
  it('an approval that meets a termination in flight waits, then answers contract_inactive; the order ends rejected', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const token = mintShareToken();
    const order = await seedVariation(orgId, contract, 'issued', { tokenHash: token.hash });

    let terminated!: () => void;
    const contractHeld = new Promise<void>((done) => (terminated = done));
    let release!: () => void;
    const released = new Promise<void>((done) => (release = done));
    // The termination core's order: the contract first, then its open orders.
    const termination = studio.begin(async (tx) => {
      await tx`update public.contracts set status = 'terminated', updated_at = now() where id = ${contract.contractId}`;
      terminated();
      await released;
      await tx`update public.variation_orders set status = 'rejected', updated_at = now()
                where contract_id = ${contract.contractId} and status = 'issued'`;
    });
    await contractHeld;

    let settled = false;
    const approval = respondToVariationByToken(token.raw, { decision: 'approve', actorName: 'Client' }).finally(() => {
      settled = true;
    });
    try {
      await new Promise((done) => setTimeout(done, 400));
      // Without the contract lock the approval had already committed by now.
      expect(settled).toBe(false);
    } finally {
      release();
      await termination;
    }

    expect(await approval).toEqual({ ok: false, error: 'contract_inactive' });
    expect(await statusOf('contracts', contract.contractId)).toBe('terminated');
    expect(await statusOf('variation_orders', order.id)).toBe('rejected');
  });

  it('an approval that commits first stays approved, and the termination after it finds the order decided', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const token = mintShareToken();
    const order = await seedVariation(orgId, contract, 'issued', { tokenHash: token.hash });
    expect(await respondToVariationByToken(token.raw, { decision: 'approve', actorName: 'Client' })).toEqual({ ok: true });
    await studio.begin(async (tx) => {
      await tx`update public.contracts set status = 'terminated', updated_at = now() where id = ${contract.contractId}`;
      await tx`update public.variation_orders set status = 'rejected', updated_at = now()
                where contract_id = ${contract.contractId} and status = 'issued'`;
    });
    expect(await statusOf('variation_orders', order.id)).toBe('approved');
  });
});
