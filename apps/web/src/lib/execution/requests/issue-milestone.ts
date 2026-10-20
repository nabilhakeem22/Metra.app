// issueMilestoneRequestCore: the studio sends the payment request (مطالبة دفع)
// for one row of a signed execution contract's schedule (plan A4.1).
//
// The row bills what the client signed: `milestoneAmounts` over the frozen
// schedule and `original_value` (plan A7), VAT inside it. One live request per
// row (`payment_requests_one_per_milestone`); a void frees the row for a new
// request under a NEW number. Nothing is billed once the final account is
// issued. A row larger than what is left to bill (billingBalance: the contract
// plus approved change orders, minus every issued request) is still sent, with
// a warning the caller can show (A4.1 addendum): a de-scope may have made the
// last instalment too big, and only the studio knows whether to send it.
import { contractPaymentMilestones, type MetraDb } from '@metra/db';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import { loadScheduleRows, scheduleView } from '@/lib/contracts/schedule/queries';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { billingBalance } from '../money/final-account';
import { loadContractMoneyFacts } from '../queries/money-facts';
import { insertPaymentRequest } from './append';
import { lockBillableContract, type BillableContract } from './billing-lock';
import { readRequestTerms, type TypedRequestTerms } from './input';

export interface IssueMilestoneRequestInput extends TypedRequestTerms {
  milestoneId?: unknown;
}

export type IssueMilestoneRequestResult = ActionResult & {
  data?: string;
  /** Present when the row bills more than was left to bill; the request was sent. */
  balanceWarning?: { balance: string };
};

/** What the row bills, from the schedule the client signed. */
async function milestoneBill(tx: MetraDb, contract: BillableContract, milestoneId: string) {
  const schedule = scheduleView(await loadScheduleRows(tx, contract.id), contract);
  const row = schedule.rows.find((candidate) => candidate.id === milestoneId);
  // Frozen at issue and checked by the issue gate: a schedule that no longer
  // adds up here is a contract changed under the gate, never billed blind.
  if (!schedule.valid || !row?.amount || !row.taxAmount) fail('contract_schedule_invalid');
  return { amount: row.amount, taxAmount: row.taxAmount };
}

export async function issueMilestoneRequestCore(
  ctx: OrgContext,
  input: IssueMilestoneRequestInput,
): Promise<IssueMilestoneRequestResult> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const milestoneId = typeof input.milestoneId === 'string' ? input.milestoneId.trim() : '';
  if (!isUuid(milestoneId)) return err('malformed');
  const issuedOn = todayInCairo(new Date());
  const read = readRequestTerms(input, issuedOn);
  if (!read.ok) return fieldsFailed(read.errors);

  // Set inside the transaction; the assertion keeps TypeScript from narrowing it to null.
  let balanceWarning = null as { balance: string } | null;
  const result = await mutateInOrg(
    ctx,
    {
      capability: 'invoices_issue',
      action: 'approve',
      capTransaction: true,
      refusals: [{ constraint: 'payment_requests_one_per_milestone', code: 'request_exists' }],
    },
    async (tx, audit) => {
      const milestone = await requireInOrg(
        tx,
        contractPaymentMilestones,
        milestoneId,
        { contractId: contractPaymentMilestones.contractId },
        'record_not_found',
      );
      const contract = await lockBillableContract(tx, milestone.contractId);
      const money = await loadContractMoneyFacts(tx, contract.id);
      if (money.finalAccount) fail('final_account_issued');
      // Under the contract lock, so this is every live request: the partial
      // unique stays the database's backstop.
      if (money.billedMilestoneIds.includes(milestoneId)) fail('request_exists');
      const bill = await milestoneBill(tx, contract, milestoneId);
      const balance = billingBalance({ ...contract, ...money });
      if (parseMoney4(bill.amount) > parseMoney4(balance)) balanceWarning = { balance };
      return insertPaymentRequest(tx, ctx, audit, {
        contractId: contract.id,
        kind: 'milestone',
        milestoneId,
        variationOrderId: null,
        ...bill,
        issuedOn,
        ...read.values,
      });
    },
  );
  return result.ok && balanceWarning ? { ...result, balanceWarning } : result;
}
