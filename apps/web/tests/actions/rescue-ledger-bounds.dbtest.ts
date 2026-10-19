import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadRescueLedgerRows } from '@/lib/dashboard/rescue-ledger/queries';
import { closeFixture, raw, teardown } from './fixture';
import { changeOrder, DAY_MS, delivery, followupAlert, HOUR_MS, ledgerOf, milestone, payment, reminder, rescueOrg, transition, type RescueOrg } from './rescue-ledger-fixture';

// The ledger's bounds against a real database: ONE statement, at most 52 rows,
// monthly sums that equal the totals, an empty org that reads as zeros, and an
// org whose figures no other org can move.

// Counts what the ledger asks of the database: every org context it opens and
// every statement it runs inside one (the context's own preamble excluded).
const calls = vi.hoisted(() => ({ contexts: 0, statements: 0 }));
vi.mock('@/lib/db/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/context')>();
  return {
    ...actual,
    withOrgContext: ((ctx, fn, opts) => {
      calls.contexts += 1;
      return actual.withOrgContext(ctx, (tx) => {
        const counted = Object.create(tx) as typeof tx;
        counted.execute = ((query: Parameters<typeof tx.execute>[0]) => {
          calls.statements += 1;
          return tx.execute(query);
        }) as typeof tx.execute;
        return fn(counted);
      }, opts);
    }) as typeof actual.withOrgContext,
  };
});

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** The start of the month `back` months before this one, as the database's clock and zone see it. */
async function monthStart(back: number): Promise<Date> {
  const [row] = await raw.query<{ at: string }>(`select to_json(date_trunc('month', now()) - make_interval(months => ${back}))#>>'{}' as at`);
  return new Date(row.at);
}

/** One delivery per month for `months` months, each with an R4, an R3 and an R2 rescue in that month. */
async function everyRiskEveryMonth(org: RescueOrg, months: number, firstNumber = 1): Promise<void> {
  for (let back = 0; back < months; back += 1) {
    const start = (await monthStart(back)).getTime();
    const day = (days: number, hours = 0) => new Date(start + days * DAY_MS + hours * HOUR_MS);
    const id = await delivery(org, firstNumber + back);
    await milestone(org, id, 'deposit', '1000.25');
    await transition(org, id, 'submitDesignFee', 'created', 'design_proposal', day(1));
    await changeOrder(org, id, '250.5', day(1, 1));
    await payment(org, id, 'deposit', '1000.25', day(2));
    await payment(org, id, 'revision_co', '250.5', day(2, 1));
    await transition(org, id, 'confirmAndPayDeposit', 'design_proposal', 'survey', day(3));
    await followupAlert(org, id, day(3, 1));
    await reminder(org, id, 'whatsapp_opened', day(3, 2));
    await transition(org, id, 'spatialBaseReady', 'survey', 'layout', day(4));
  }
}

/** Piastre exact sum of scale 4 money strings, back to a scale 4 string. */
function sumAmounts(amounts: string[]): string {
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount.replace('.', '')), 0n).toString().padStart(5, '0');
  return `${total.slice(0, -4)}.${total.slice(-4)}`;
}

describe('rescue ledger bounds', () => {
  it('runs ONE statement in ONE org context and answers at most 52 rows for 12 months (AC19)', async () => {
    const org = await rescueOrg(orgIds);
    await everyRiskEveryMonth(org, 12);
    calls.contexts = 0;
    calls.statements = 0;
    const read = await loadRescueLedgerRows(org.contexts.owner, 12, false);
    expect(calls).toEqual({ contexts: 1, statements: 1 });
    expect(read.rows).toHaveLength(52);
  });

  it('a 12 month window has 12 months, and every monthly sum equals its total (AC3, AC15)', async () => {
    const org = await rescueOrg(orgIds);
    await everyRiskEveryMonth(org, 12);
    const ledger = await ledgerOf(org, 12);
    expect(ledger.months).toHaveLength(12);
    expect(ledger.heldFees).toEqual({ amount: '12003.0000', payments: 12, deliveries: 12 });
    expect(ledger.changeOrders.amount).toBe('3006.0000');
    expect(sumAmounts(ledger.months.map((m) => m.heldFeesAmount))).toBe(ledger.heldFees.amount);
    expect(sumAmounts(ledger.months.map((m) => m.changeOrdersAmount))).toBe(ledger.changeOrders.amount);
    expect(sumAmounts(ledger.months.map((m) => m.collectedAmount))).toBe(ledger.collected.amount);
    expect(ledger.collected.amount).toBe('15009.0000');
    expect(ledger.months.reduce((sum, m) => sum + m.stagesMoved, 0)).toBe(ledger.stagesMoved.count);
    expect(ledger.stagesMoved).toEqual({ count: 12, deliveries: 12, followups: 12 });
  });

  it('a 3 month window counts only its own 3 months', async () => {
    const org = await rescueOrg(orgIds);
    await everyRiskEveryMonth(org, 12);
    const ledger = await ledgerOf(org, 3);
    expect(ledger.months).toHaveLength(3);
    expect(ledger.heldFees.payments).toBe(3);
    expect(ledger.stagesMoved.count).toBe(3);
  });

  it('an empty org reads as zeros everywhere (AC14)', async () => {
    const org = await rescueOrg(orgIds);
    const ledger = await ledgerOf(org, 6);
    const zero = { amount: '0.0000', payments: 0, deliveries: 0 };
    expect(ledger).toMatchObject({ rangeMonths: 6, collected: zero, heldFees: zero, changeOrders: zero, stagesMoved: { count: 0, deliveries: 0, followups: 0 } });
    expect(ledger.months).toHaveLength(6);
    for (const month of ledger.months) {
      expect(month).toMatchObject({ heldFeesAmount: '0.0000', changeOrdersAmount: '0.0000', collectedAmount: '0.0000', stagesMoved: 0 });
    }
  });

  it('another org with identical rows moves none of this org figures (AC13)', async () => {
    const first = await rescueOrg(orgIds);
    await everyRiskEveryMonth(first, 4);
    const before = await ledgerOf(first, 6);
    const second = await rescueOrg(orgIds);
    await everyRiskEveryMonth(second, 4);
    expect(await ledgerOf(first, 6)).toEqual(before);
    expect((await ledgerOf(second, 6)).heldFees).toEqual(before.heldFees);
  });
});
