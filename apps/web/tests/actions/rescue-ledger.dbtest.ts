import { afterAll, describe, expect, it } from 'vitest';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import type { RescueLedger } from '@/lib/dashboard/rescue-ledger/types';
import { closeFixture, raw, teardown } from './fixture';
import { changeOrder, DAY_MS, delivery, HOUR_MS, monthOf, payment, rescueOrg, transition, type RescueOrg } from './rescue-ledger-fixture';

// The Risk & Rescue Ledger v1 against a real database: the gate (D1), and each
// rule's record order (R4, R3, R2). Cases from the plan's acceptance criteria.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Every case sits 20 days back, well inside the default 6 month window. */
const t0 = new Date(Date.now() - 20 * DAY_MS);
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * HOUR_MS);

async function ledgerOf(org: RescueOrg, range: 3 | 6 | 12 = 6): Promise<RescueLedger> {
  const result = await loadRescueLedgerCore(org.contexts.owner, { range });
  if (!result.ok) throw new Error(`ledger refused: ${result.error}`);
  return result.data;
}

async function heldDeposit(org: RescueOrg, number: number, amount: string): Promise<string> {
  const id = await delivery(org, number);
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
    await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, id, 'deposit', '4000', at(-1));
    await payment(org, id, 'deposit', '6000', at(2));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(3));
    const ledger = await ledgerOf(org);
    expect(ledger.heldFees).toEqual({ amount: '6000.0000', payments: 1, deliveries: 1 });
    const month = await monthOf(at(3));
    expect(ledger.months.find((m) => m.month === month)?.heldFeesAmount).toBe('6000.0000');
  });

  it('counts nothing on a delivery that never passed the gate, still waiting or abandoned there (AC5)', async () => {
    const org = await rescueOrg(orgIds);
    const waiting = await delivery(org, 1);
    await transition(org, waiting, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, waiting, 'deposit', '3000', at(1));
    const abandoned = await delivery(org, 2);
    await transition(org, abandoned, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, abandoned, 'deposit', '3000', at(1));
    await transition(org, abandoned, 'abandon', 'design_proposal', 'abandoned', at(2));
    expect((await ledgerOf(org)).heldFees).toEqual({ amount: '0.0000', payments: 0, deliveries: 0 });
  });

  it('a self loop in the gate state is not an arrival', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await transition(org, id, 'attestAsBuiltClean', 'final_approval', 'final_approval', at(0));
    await payment(org, id, 'gate_b', '3000', at(1));
    await transition(org, id, 'approveDesign', 'final_approval', 'shop_drawings', at(2));
    expect((await ledgerOf(org)).heldFees.payments).toBe(0);
  });

  it('skips a delivery with no recorded arrival at the gate (A10)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await payment(org, id, 'deposit', '3000', at(1));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(2));
    expect((await ledgerOf(org)).heldFees.payments).toBe(0);
  });
});

describe('R3 and R4 together: one payment, one risk (AC6)', () => {
  it('a held deposit and a paid change order add up in collected, each counted once', async () => {
    const org = await rescueOrg(orgIds);
    const id = await heldDeposit(org, 1, '5000');
    await changeOrder(org, id, '2000', at(4));
    await payment(org, id, 'revision_co', '2000', at(5));
    const ledger = await ledgerOf(org);
    expect(ledger.heldFees.amount).toBe('5000.0000');
    expect(ledger.changeOrders.amount).toBe('2000.0000');
    expect(ledger.collected).toEqual({ amount: '7000.0000', payments: 2, deliveries: 1 });
  });
});

describe('R3: extra revisions billed and paid', () => {
  it('caps the paid amount at the change orders raised by then (AC7)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await changeOrder(org, id, '5000', at(0));
    await payment(org, id, 'revision_co', '3000', at(1));
    await payment(org, id, 'revision_co', '4000', at(2));
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '5000.0000', payments: 2, deliveries: 1 });
    await changeOrder(org, id, '1000', at(3));
    await payment(org, id, 'revision_co', '500', at(4));
    expect((await ledgerOf(org)).changeOrders.amount).toBe('6000.0000');
  });

  it('counts 0 for a payment with no change order raised at or before it (AC8)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await payment(org, id, 'revision_co', '3000', at(1));
    await changeOrder(org, id, '3000', at(2));
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '0.0000', payments: 0, deliveries: 0 });
  });
});
