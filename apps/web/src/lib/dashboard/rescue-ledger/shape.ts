// SQL rows -> the ledger contract. PURE: no arithmetic on money (every amount is
// a string Postgres summed), only lookup and gap filling, so a quiet month is
// present and zeroed rather than skipped.
import { monthsInRange, type RangeMonths } from '../range';
import type { RescueLedger, RescueLedgerRow, RescueMoneyFigure, RescueRowRisk } from './types';

/** What an empty money figure reads as: the SQL scale, so empty and summed figures look alike. */
const ZERO_AMOUNT = '0.0000';

function rowKey(risk: RescueRowRisk, month: string | null): string {
  return `${risk}|${month ?? 'total'}`;
}

function moneyFigure(row: RescueLedgerRow | undefined): RescueMoneyFigure {
  return { amount: row?.amount ?? ZERO_AMOUNT, payments: row?.events ?? 0, deliveries: row?.deliveries ?? 0 };
}

export function shapeRescueLedger(
  rows: readonly RescueLedgerRow[],
  range: RangeMonths,
  now: Date = new Date(),
): RescueLedger {
  const byKey = new Map(rows.map((row) => [rowKey(row.risk, row.month), row]));
  const find = (risk: RescueRowRisk, month: string | null) => byKey.get(rowKey(risk, month));
  const moved = find('r2', null);
  return {
    rangeMonths: range,
    collected: moneyFigure(find('collected', null)),
    heldFees: moneyFigure(find('r4', null)),
    changeOrders: moneyFigure(find('r3', null)),
    stagesMoved: { count: moved?.events ?? 0, deliveries: moved?.deliveries ?? 0, followups: moved?.followups ?? 0 },
    months: monthsInRange(range, now).map((month) => ({
      month,
      heldFeesAmount: find('r4', month)?.amount ?? ZERO_AMOUNT,
      changeOrdersAmount: find('r3', month)?.amount ?? ZERO_AMOUNT,
      collectedAmount: find('collected', month)?.amount ?? ZERO_AMOUNT,
      stagesMoved: find('r2', month)?.events ?? 0,
    })),
  };
}
