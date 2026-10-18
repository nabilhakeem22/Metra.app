// The Risk & Rescue Ledger's contract, v1. PURE and CLIENT-SAFE: types only, so
// the route, the core and the browser island all read one shape.
//
// Money is a numeric(18,4) STRING summed in Postgres; nothing here is ever
// added up in JavaScript. `collected` is real money (R3 + R4) and only real
// money: no estimate is ever part of it, or of anything in this file.
import type { RangeMonths } from '@/lib/dashboard/range';

/** r2 stages moved after a follow up; r3 extra revisions billed and paid; r4 stage fees paid while held; collected = r3 + r4. */
export type RescueRowRisk = 'r2' | 'r3' | 'r4' | 'collected';

/** One SQL row. `month` null = the window total for that risk. */
export interface RescueLedgerRow {
  risk: RescueRowRisk;
  /** 'YYYY-MM', or null on the window total. */
  month: string | null;
  /** r2: stages moved; r3/r4: payments counted; collected: r3 + r4 payments. */
  events: number;
  /** Distinct deliveries. */
  deliveries: number;
  /** numeric(18,4) as text; null for r2. */
  amount: string | null;
  /** r2 only: the follow up alerts in the counted chains. */
  followups: number | null;
}

export interface RescueMoneyFigure {
  amount: string;
  payments: number;
  deliveries: number;
}

export interface RescueLedgerMonth {
  /** 'YYYY-MM', oldest first. */
  month: string;
  /** R4, '0.0000' when empty. */
  heldFeesAmount: string;
  /** R3, '0.0000' when empty. */
  changeOrdersAmount: string;
  /** R3 + R4, summed in SQL. */
  collectedAmount: string;
  /** R2. */
  stagesMoved: number;
}

export interface RescueLedger {
  rangeMonths: RangeMonths;
  /** R3 + R4 ONLY. Never includes any estimate. */
  collected: RescueMoneyFigure;
  /** R4. */
  heldFees: RescueMoneyFigure;
  /** R3. */
  changeOrders: RescueMoneyFigure;
  /** R2. */
  stagesMoved: { count: number; deliveries: number; followups: number };
  /** length === rangeMonths, empty months filled. */
  months: RescueLedgerMonth[];
}

export type RescueLedgerResponse =
  | { ok: true; ledger: RescueLedger }
  | { ok: false; error: 'unauthorized' | 'forbidden' | 'generic'; reference?: string };
