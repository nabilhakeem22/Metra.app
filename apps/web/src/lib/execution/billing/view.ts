import 'server-only';
// Everything the contract's Payments tab shows, in one org transaction:
// the schedule rows with whether each is billed, the approved change orders
// still to bill, the client's claims that wait for an answer, the newest
// requests with what is paid and due on each, the first page of the payment
// ledger, and what is left to bill. Every part is bounded (12 schedule rows,
// 50 change orders, 100 claims, 100 requests, 50 payments) and
// money is aggregated in SQL, so the tab's cost does not grow with the ledger.
import type { ContractStatus } from '@metra/db';
import { contractIssuedOnInCairo } from '@/lib/contracts/queries/issued-on';
import { loadScheduleRows, scheduleView } from '@/lib/contracts/schedule/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { listPendingClaims, type PendingClaimRow } from '../claims/queries';
import { billingBalance } from '../money/final-account';
import { listContractPayments, type ContractPaymentsPage } from '../payments/queries';
import { loadExecutionContract } from '../queries/execution-contract';
import { loadContractMoneyFacts } from '../queries/money-facts';
import {
  listBillableVariations,
  listPaymentRequests,
  type BillableVariationRow,
  type PaymentRequestRow,
} from '../requests/queries';

interface ScheduleBillingRow {
  id: string;
  labelAr: string | null;
  labelEn: string | null;
  /** What the row bills; null while the schedule does not add up (a draft). */
  amount: string | null;
  /** An issued request bills it already. */
  billed: boolean;
}

export interface ContractBillingView {
  contractId: string;
  status: ContractStatus;
  /** The day it was issued, in Cairo (`YYYY-MM-DD`): no payment is dated before it. */
  issuedOn: string;
  finalAccountIssued: boolean;
  /** The contract plus approved change orders, minus every issued request. */
  billingBalance: string;
  schedule: ScheduleBillingRow[];
  variations: BillableVariationRow[];
  /** The client's "I paid" claims that wait for the studio (B4), oldest first. */
  claims: PendingClaimRow[];
  requests: PaymentRequestRow[];
  /** More requests than the tab shows (the newest 100). */
  moreRequests: boolean;
  payments: ContractPaymentsPage;
}

export function getContractBilling(ctx: OrgContext, contractId: string): Promise<ContractBillingView | null> {
  return withOrgContext(ctx, async (tx) => {
    const contract = await loadExecutionContract(tx, contractId);
    if (!contract) return null;
    const schedule = scheduleView(await loadScheduleRows(tx, contractId), contract);
    const money = await loadContractMoneyFacts(tx, contractId);
    const billed = new Set(money.billedMilestoneIds);
    const requests = await listPaymentRequests(tx, contractId);
    return {
      contractId,
      status: contract.status,
      issuedOn: await contractIssuedOnInCairo(tx, contractId),
      finalAccountIssued: money.finalAccount !== null,
      billingBalance: billingBalance({ ...contract, ...money }),
      schedule: schedule.rows.map((row) => ({
        id: row.id,
        labelAr: row.labelAr,
        labelEn: row.labelEn,
        amount: row.amount,
        billed: billed.has(row.id),
      })),
      variations: await listBillableVariations(tx, contract),
      claims: await listPendingClaims(tx, contractId),
      requests: requests.rows,
      moreRequests: requests.hasMore,
      payments: await listContractPayments(tx, contractId, null),
    };
  });
}

/** One more page of the ledger, after `after`; null when the contract is not the caller's. */
export function getContractPaymentsPage(
  ctx: OrgContext,
  contractId: string,
  after: { receivedOn: string; id: string },
): Promise<ContractPaymentsPage | null> {
  return withOrgContext(ctx, async (tx) =>
    (await loadExecutionContract(tx, contractId)) ? listContractPayments(tx, contractId, after) : null,
  );
}
