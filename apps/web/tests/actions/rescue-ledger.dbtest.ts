import { afterAll, describe, expect, it } from 'vitest';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import { closeFixture, raw, teardown } from './fixture';
import { DAY_MS, delivery, HOUR_MS, ledgerOf, milestone, monthOf, payment, rescueOrg, transition, type RescueOrg } from './rescue-ledger-fixture';

// The Risk & Rescue Ledger v1 against a real database: the gate (D1) and R4,
// stage fees paid while the stage was held. R3 and R2 have their own files.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Every case sits 20 days back, well inside the default 6 month window. */
const t0 = new Date(Date.now() - 20 * DAY_MS);
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * HOUR_MS);

/** A deposit milestone of `amount`, met by one payment after the arrival at the gate. */
async function heldDeposit(org: RescueOrg, number: number, amount: string): Promise<string> {
  const id = await delivery(org, number);
  await milestone(org, id, 'deposit', amount);
  await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
  await payment(org, id, 'deposit', amount, at(2));
  await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(3));
  return id;
}

describe('the gate (D1): finance roles, narrowed by the firm figures limit', () => {
  it('owner, admin and accountant read it; project manager, site engineer and viewer are refused', async () => {
    const org = await rescueOrg(orgIds);
    for (const role of ['owner', 'admin', 'accountant'] as const) {
      expect((await loadRescueLedgerCore(org.contexts[role], { range: 6 })).ok).toBe(true);
    }
    for (const role of ['project_manager', 'site_engineer', 'viewer'] as const) {
      expect(await loadRescueLedgerCore(org.contexts[role], { range: 6 })).toEqual({ ok: false, error: 'forbidden' });
    }
  });

  it('with the limit on, the accountant is refused and owner and admin still read it', async () => {
    const org = await rescueOrg(orgIds);
    await heldDeposit(org, 1, '5000');
    await raw.query(`update public.organizations set restrict_firm_dashboard = true where id = '${org.orgId}'`);
    expect(await loadRescueLedgerCore(org.contexts.accountant, { range: 6 })).toEqual({ ok: false, error: 'forbidden' });
    for (const role of ['owner', 'admin'] as const) {
      const result = await loadRescueLedgerCore(org.contexts[role], { range: 6 });
      expect(result).toMatchObject({ ok: true, data: { heldFees: { amount: '5000.0000' } } });
    }
  });
});

describe('R4: stage fees paid while the stage was held', () => {
  it('counts only the payment that cleared after the delivery reached the gate (AC4)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await milestone(org, id, 'deposit', '10000');
    await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, id, 'deposit', '4000', at(-1));
    await payment(org, id, 'deposit', '6000', at(2));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(3));
    const ledger = await ledgerOf(org);
    expect(ledger.heldFees).toEqual({ amount: '6000.0000', payments: 1, deliveries: 1 });
    const month = await monthOf(at(3));
    expect(ledger.months.find((m) => m.month === month)?.heldFeesAmount).toBe('6000.0000');
  });

  it('counts nothing when the milestone was already covered on arrival (F4, over payment)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await milestone(org, id, 'gate_a', '20000');
    await payment(org, id, 'gate_a', '20000', at(-2));
    await transition(org, id, 'optionsReady', 'layout', 'concept_review', at(0));
    await payment(org, id, 'gate_a', '5000', at(1));
    await transition(org, id, 'selectConcept', 'concept_review', 'negotiation', at(2));
    expect((await ledgerOf(org)).heldFees).toEqual({ amount: '0.0000', payments: 0, deliveries: 0 });
  });

  it('caps the money counted at the shortfall on arrival, in payment order', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await milestone(org, id, 'deposit', '10000');
    await payment(org, id, 'deposit', '4000', at(-1));
    await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, id, 'deposit', '3000', at(1));
    await payment(org, id, 'deposit', '5000', at(2));
    await payment(org, id, 'deposit', '700', at(2, 1));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(3));
    expect((await ledgerOf(org)).heldFees).toEqual({ amount: '6000.0000', payments: 2, deliveries: 1 });
  });

  it('prices a percent milestone from the design fee, rounded to the piastre as the guard does', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    // 25% of 100,000.0001 is 25,000.000025, which the guard rounds to 25,000.0000:
    // the 25,000 payment meets it, so the extra 1 is not held.
    await milestone(org, id, 'gate_b', '25', 'percent', '100000.0001');
    await transition(org, id, 'rendersReady', 'design_3d', 'final_approval', at(0));
    await payment(org, id, 'gate_b', '25000', at(1));
    await payment(org, id, 'gate_b', '1', at(1, 1));
    await transition(org, id, 'approveDesign', 'final_approval', 'shop_drawings', at(2));
    expect((await ledgerOf(org)).heldFees).toEqual({ amount: '25000.0000', payments: 1, deliveries: 1 });
  });

  it('holds nothing at a gate with no milestone (a free gate)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await transition(org, id, 'optionsReady', 'layout', 'concept_review', at(0));
    await payment(org, id, 'gate_a', '3000', at(1));
    await transition(org, id, 'selectConcept', 'concept_review', 'negotiation', at(2));
    expect((await ledgerOf(org)).heldFees.payments).toBe(0);
  });

  it('counts nothing on a delivery that never passed the gate, still waiting or abandoned there (AC5)', async () => {
    const org = await rescueOrg(orgIds);
    for (const [number, abandon] of [[1, false], [2, true]] as const) {
      const id = await delivery(org, number);
      await milestone(org, id, 'deposit', '3000');
      await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
      await payment(org, id, 'deposit', '3000', at(1));
      if (abandon) await transition(org, id, 'abandon', 'design_proposal', 'abandoned', at(2));
    }
    expect((await ledgerOf(org)).heldFees).toEqual({ amount: '0.0000', payments: 0, deliveries: 0 });
  });

  it('a self loop in the gate state is not an arrival, and no arrival at all is skipped (A10)', async () => {
    const org = await rescueOrg(orgIds);
    const looped = await delivery(org, 1);
    await milestone(org, looped, 'gate_b', '3000');
    await transition(org, looped, 'attestAsBuiltClean', 'final_approval', 'final_approval', at(0));
    await payment(org, looped, 'gate_b', '3000', at(1));
    await transition(org, looped, 'approveDesign', 'final_approval', 'shop_drawings', at(2));
    const legacy = await delivery(org, 2);
    await milestone(org, legacy, 'deposit', '3000');
    await payment(org, legacy, 'deposit', '3000', at(1));
    await transition(org, legacy, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(2));
    expect((await ledgerOf(org)).heldFees.payments).toBe(0);
  });
});
