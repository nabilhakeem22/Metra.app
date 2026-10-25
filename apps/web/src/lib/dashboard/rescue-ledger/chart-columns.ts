// The rescue ledger's two monthly charts, shaped for DashboardBarChart. PURE and
// CLIENT-SAFE. A bar's HEIGHT needs a number, so each amount is read as one for
// geometry only; every figure a reader sees is the SQL string, formatted
// (formatMoney / formatNumber, Latin digits), never a JavaScript sum.
import type { ChartColumn, MonthLabel } from '../chart-columns';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { RescueLedgerMonth } from './types';

export const RESCUE_SERIES_KEYS = { heldFees: 'heldFees', changeOrders: 'changeOrders', stagesMoved: 'stagesMoved' } as const;

/** Held stage fees under change orders, per month; the total is the SQL collected sum. */
export function collectedColumns(months: readonly RescueLedgerMonth[], locale: string, label: MonthLabel): ChartColumn[] {
  return months.map((month) => ({
    month: month.month,
    label: label(month.month),
    segments: [
      { key: RESCUE_SERIES_KEYS.heldFees, value: Number(month.heldFeesAmount), display: formatMoney(month.heldFeesAmount, locale) },
      { key: RESCUE_SERIES_KEYS.changeOrders, value: Number(month.changeOrdersAmount), display: formatMoney(month.changeOrdersAmount, locale) },
    ],
    totalDisplay: formatMoney(month.collectedAmount, locale),
  }));
}

/** Stages moved after a follow up, per month. */
export function stagesMovedColumns(months: readonly RescueLedgerMonth[], locale: string, label: MonthLabel): ChartColumn[] {
  return months.map((month) => ({
    month: month.month,
    label: label(month.month),
    segments: [{ key: RESCUE_SERIES_KEYS.stagesMoved, value: month.stagesMoved, display: formatNumber(month.stagesMoved, locale) }],
    totalDisplay: formatNumber(month.stagesMoved, locale),
  }));
}
