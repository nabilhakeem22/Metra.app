import { describe, expect, it } from 'vitest';
import { shapeRescueLedger } from './shape';
import type { RescueLedgerRow } from './types';

const NOW = new Date('2026-10-19T12:00:00.000Z');

const row = (risk: RescueLedgerRow['risk'], month: string | null, events: number, amount: string | null, followups: number | null = null): RescueLedgerRow => ({
  risk,
  month,
  events,
  deliveries: 1,
  amount,
  followups,
});

describe('shapeRescueLedger', () => {
  it('reads no rows as zeros everywhere, with every month of the window present', () => {
    const ledger = shapeRescueLedger([], 6, NOW);
    const zero = { amount: '0.0000', payments: 0, deliveries: 0 };
    expect(ledger).toMatchObject({ rangeMonths: 6, collected: zero, heldFees: zero, changeOrders: zero, stagesMoved: { count: 0, deliveries: 0, followups: 0 } });
    expect(ledger.months.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(ledger.months.every((m) => m.collectedAmount === '0.0000' && m.stagesMoved === 0)).toBe(true);
  });

  it('places each risk on its card and each month row on its month, copying the SQL sums verbatim', () => {
    const ledger = shapeRescueLedger(
      [
        row('r4', null, 2, '6000.0000'),
        row('r4', '2026-09', 2, '6000.0000'),
        row('r3', null, 1, '2000.5000'),
        row('r3', '2026-10', 1, '2000.5000'),
        row('collected', null, 3, '8000.5000'),
        row('collected', '2026-09', 2, '6000.0000'),
        row('collected', '2026-10', 1, '2000.5000'),
        row('r2', null, 4, null, 7),
        row('r2', '2026-08', 4, null, 7),
      ],
      3,
      NOW,
    );
    expect(ledger.heldFees).toEqual({ amount: '6000.0000', payments: 2, deliveries: 1 });
    expect(ledger.changeOrders.amount).toBe('2000.5000');
    expect(ledger.collected).toEqual({ amount: '8000.5000', payments: 3, deliveries: 1 });
    expect(ledger.stagesMoved).toEqual({ count: 4, deliveries: 1, followups: 7 });
    expect(ledger.months).toEqual([
      { month: '2026-08', heldFeesAmount: '0.0000', changeOrdersAmount: '0.0000', collectedAmount: '0.0000', stagesMoved: 4 },
      { month: '2026-09', heldFeesAmount: '6000.0000', changeOrdersAmount: '0.0000', collectedAmount: '6000.0000', stagesMoved: 0 },
      { month: '2026-10', heldFeesAmount: '0.0000', changeOrdersAmount: '2000.5000', collectedAmount: '2000.5000', stagesMoved: 0 },
    ]);
  });

  it('has exactly rangeMonths months for each window', () => {
    for (const range of [3, 6, 12] as const) expect(shapeRescueLedger([], range, NOW).months).toHaveLength(range);
  });
});
