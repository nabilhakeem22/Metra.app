import 'server-only';
// The payment schedule of one contract, as the contract page
// (getContractPageExecution) and the issue gate read it, and what each row
// bills (scheduleView, which the delivery's execution facts apply to the rows
// their own SQL source carries). At most 12 rows (MAX_SCHEDULE_ROWS), so
// nothing here grows with the size of the contract.
import { contractPaymentMilestones, type MetraDb } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { milestoneAmounts } from '@/lib/execution/money/milestone-amounts';
import { validateSchedule, type CleanScheduleRow } from '@/lib/execution/money/schedule';

export interface StoredScheduleRow extends CleanScheduleRow {
  id: string;
}

/** What a schedule row bills; amounts are null while the schedule does not add up. */
export interface ScheduleRowView extends StoredScheduleRow {
  amount: string | null;
  taxAmount: string | null;
}

export interface ContractScheduleView {
  rows: ScheduleRowView[];
  /** The rows pass `validateSchedule` against the contract's current value. */
  valid: boolean;
}

/** The stored rows, in sort order. */
export async function loadScheduleRows(tx: MetraDb, contractId: string): Promise<StoredScheduleRow[]> {
  return tx
    .select({
      id: contractPaymentMilestones.id,
      labelAr: contractPaymentMilestones.labelAr,
      labelEn: contractPaymentMilestones.labelEn,
      basis: contractPaymentMilestones.basis,
      value: contractPaymentMilestones.value,
      sortOrder: contractPaymentMilestones.sortOrder,
    })
    .from(contractPaymentMilestones)
    .where(eq(contractPaymentMilestones.contractId, contractId))
    .orderBy(asc(contractPaymentMilestones.sortOrder));
}

/**
 * The rows with what each bills. A schedule stops adding up when the charges
 * change the value under an amount-based one; it then shows no amounts, and
 * the issue gate refuses it until it is saved again.
 */
export function scheduleView(
  rows: StoredScheduleRow[],
  contract: { originalValue: string; taxAmount: string },
): ContractScheduleView {
  const valid = rows.length > 0 && validateSchedule(rows, contract.originalValue, contract.taxAmount).ok;
  const amounts = valid ? milestoneAmounts(rows, contract.originalValue, contract.taxAmount) : [];
  return {
    valid,
    rows: rows.map((row, index) => ({
      ...row,
      amount: amounts[index]?.amount ?? null,
      taxAmount: amounts[index]?.taxAmount ?? null,
    })),
  };
}
