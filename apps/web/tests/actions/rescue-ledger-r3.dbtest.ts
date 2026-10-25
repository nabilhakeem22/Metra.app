import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, teardown } from './fixture';
import { changeOrder, DAY_MS, delivery, HOUR_MS, ledgerOf, milestone, monthOf, payment, rescueOrg, transition } from './rescue-ledger-fixture';

// R3, extra revisions billed and paid, against a real database: each
// revision_co payment counts against the change orders raised before it, never
// for more than its own amount, in its own month.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const t0 = new Date(Date.now() - 20 * DAY_MS);
const at = (days: number, hours = 0) => new Date(t0.getTime() + days * DAY_MS + hours * HOUR_MS);

describe('R3 and R4 together: one payment, one risk (AC6)', () => {
  it('a held deposit and a paid change order add up in collected, each counted once', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await milestone(org, id, 'deposit', '5000');
    await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', at(0));
    await payment(org, id, 'deposit', '5000', at(2));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', at(3));
    await changeOrder(org, id, '2000', at(4));
    await payment(org, id, 'revision_co', '2000', at(5));
    const ledger = await ledgerOf(org);
    expect(ledger.heldFees.amount).toBe('5000.0000');
    expect(ledger.changeOrders.amount).toBe('2000.0000');
    expect(ledger.collected).toEqual({ amount: '7000.0000', payments: 2, deliveries: 1 });
  });
});

describe('R3: extra revisions billed and paid', () => {
  it('caps the paid amount at the change orders raised by then, each payment at most itself (AC7)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await changeOrder(org, id, '5000', at(0));
    await payment(org, id, 'revision_co', '3000', at(1));
    await payment(org, id, 'revision_co', '4000', at(2));
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '5000.0000', payments: 2, deliveries: 1 });
    await changeOrder(org, id, '1000', at(3));
    await payment(org, id, 'revision_co', '500', at(4));
    // 3,000 + 2,000 + 500: the 500 payment counts 500, not the 1,000 still uncovered.
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '5500.0000', payments: 3, deliveries: 1 });
  });

  it('counts 0 for a payment with no change order raised at or before it (AC8)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await payment(org, id, 'revision_co', '3000', at(1));
    await changeOrder(org, id, '3000', at(2));
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '0.0000', payments: 0, deliveries: 0 });
  });

  it('a payment before the change order never moves to a later payment (F1): 5,000 first, then the CO, then 1 counts 1', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await payment(org, id, 'revision_co', '5000', at(1));
    await changeOrder(org, id, '5000', at(2));
    await payment(org, id, 'revision_co', '1', at(3));
    const ledger = await ledgerOf(org);
    expect(ledger.changeOrders).toEqual({ amount: '1.0000', payments: 1, deliveries: 1 });
    expect(ledger.collected.amount).toBe('1.0000');
  });

  it('one payment of 1,000 counts 1,000, not 3,000 (F1, fixture case)', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    await payment(org, id, 'revision_co', '2000', at(1));
    await changeOrder(org, id, '2000', at(2));
    await changeOrder(org, id, '1000', at(3));
    await payment(org, id, 'revision_co', '1000', at(4));
    expect((await ledgerOf(org)).changeOrders).toEqual({ amount: '1000.0000', payments: 1, deliveries: 1 });
  });

  it('puts each counted amount in its own payment month', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    const early = new Date(t0.getTime() - 40 * DAY_MS);
    await changeOrder(org, id, '5000', early);
    await payment(org, id, 'revision_co', '2000', early);
    await payment(org, id, 'revision_co', '3000', at(1));
    const ledger = await ledgerOf(org);
    // 40 days apart, so always two calendar months.
    const months = [await monthOf(early), await monthOf(at(1))];
    expect(months.map((month) => ledger.months.find((m) => m.month === month)?.changeOrdersAmount)).toEqual(['2000.0000', '3000.0000']);
  });
});
