// A delivery's execution facts, DERIVED from the one fact source
// (./flow-source.ts, `app_execution_flow_source`). No database read here: the
// studio's cockpit card and the client home derive their ExecutionFlowFacts
// from the same SQL's answer, so the two projections can never be fed
// different facts. The money rules are the money module's
// (./money/final-account.ts), never re-written.
import type { ContractStatus } from '@metra/db';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { scheduleView, type ContractScheduleView, type ScheduleRowView } from '@/lib/contracts/schedule/queries';
import type { ExecutionFlowFacts } from '@/lib/flow/locate/execution-facts';
import type { ContractMoneyFacts, ExecutionFlowSource } from './flow-source';
import { billingBalance, finalAccountBalance } from './money/final-account';
import type { ExecutionContractFacts } from './stage';

export interface ExecutionCardContract {
  id: string;
  number: number;
  createdAt: string;
  status: ContractStatus;
}

export interface ExecutionCardFacts {
  /** The one execution fact model both the cockpit and the client home read (lib/flow/locate/execution-facts.ts). */
  flow: ExecutionFlowFacts;
  /** The delivery's issued BOQ: what "create contract" generates from. */
  boqId: string | null;
  contract: ExecutionCardContract | null;
  /** The labels of the schedule row the next payment request bills (the card names it). */
  nextInstalment: { labelAr: string | null; labelEn: string | null } | null;
}

/** What deriving a contract's stage reads off the contract row. */
export interface StagedContract {
  id: string;
  status: ContractStatus;
  originalValue: string;
  taxAmount: string;
  taxRate: string;
  supervisionPct: string;
  discountPct: string;
}

/** What a signed contract's change orders and requests add to the flow facts (zero before it is signed). */
type ContractFlowCounts = Pick<ExecutionFlowFacts, 'issuedChangeOrderCount' | 'expiredChangeOrderCount' | 'unclaimedDueRequestCount'>;

/** A contract that bills nothing yet changes nothing either. */
const NO_FLOW_COUNTS: ContractFlowCounts = { issuedChangeOrderCount: 0, expiredChangeOrderCount: 0, unclaimedDueRequestCount: 0 };

/** The first schedule row no issued request bills yet. */
function firstUnbilled(rows: ScheduleRowView[], money: ContractMoneyFacts): (ScheduleRowView & { amount: string }) | null {
  const billed = new Set(money.billedMilestoneIds);
  const row = rows.find((candidate) => !billed.has(candidate.id) && candidate.amount !== null);
  return row?.amount ? { ...row, amount: row.amount } : null;
}

/** Once the final account request is issued, both balances are its figures (plan A3.5 addendum). */
function issuedFinalBalance(money: ContractMoneyFacts): string | null {
  if (!money.finalAccount) return null;
  return formatMoney4(parseMoney4(money.finalAccount.finalValue) - parseMoney4(money.issuedRequestsTotal));
}

/** The measured works the full balance needs while no final account is issued. */
function requiredMeasuredWorks(billing: SignedContractBilling): string {
  if (billing.measuredWorks === null) {
    throw new Error('a signed contract with no final account is staged without its measured works');
  }
  return billing.measuredWorks;
}

/** What a signed contract's billing reads: its money facts, and its measured works until a final account is issued. */
export interface SignedContractBilling {
  money: ContractMoneyFacts;
  /** Null once a final account request is issued (its figures replace the measurement). */
  measuredWorks: string | null;
}

/**
 * A contract's stage facts, and the row it bills next. A draft or an unsigned
 * contract bills nothing yet (`billing` null); a signed one needs its billing,
 * and its measured works unless a final account is issued.
 */
export function contractStageFacts(
  contract: StagedContract,
  schedule: ContractScheduleView,
  billing: SignedContractBilling | null,
): {
  facts: ExecutionContractFacts;
  counts: ContractFlowCounts;
  next: { labelAr: string | null; labelEn: string | null } | null;
} {
  const idle: ExecutionContractFacts = {
    status: contract.status,
    scheduleValid: schedule.valid,
    nextUnbilledMilestone: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 0,
    openVariationCount: 0,
    billingBalance: '0',
    finalAccountBalance: '0',
  };
  if (contract.status !== 'signed') return { facts: idle, counts: NO_FLOW_COUNTS, next: null };
  if (!billing) throw new Error('a signed contract is staged without its billing facts');

  const { money } = billing;
  const basis = {
    ...contract,
    approvedVariationNetDeltas: money.approvedVariationNetDeltas,
    issuedRequestsTotal: money.issuedRequestsTotal,
  };
  const issued = issuedFinalBalance(money);
  // Before a final account request: steering on billingBalance, the end state
  // on the full balance with the measured provisional lines (A3.5 addendum).
  const full = issued ?? finalAccountBalance(basis, requiredMeasuredWorks(billing));
  const next = firstUnbilled(schedule.rows, money);
  const facts: ExecutionContractFacts = {
    ...idle,
    nextUnbilledMilestone: next && { id: next.id, amount: next.amount },
    pendingClaimCount: money.pendingClaimCount,
    unbilledVariationCount: money.unbilledVariationCount,
    finalAccountOutstanding: money.finalAccount?.outstanding ?? null,
    unpaidRequestCount: money.unpaidRequestCount,
    openVariationCount: money.openVariationCount,
    billingBalance: issued ?? billingBalance(basis),
    finalAccountBalance: full,
  };
  return {
    facts,
    counts: {
      issuedChangeOrderCount: money.issuedVariationCount,
      expiredChangeOrderCount: money.expiredVariationCount,
      unclaimedDueRequestCount: money.unclaimedDueRequestCount,
    },
    next: next && { labelAr: next.labelAr, labelEn: next.labelEn },
  };
}

/** The execution card's facts, and the flow facts both audiences locate from, out of the one fact source. */
export function executionCardFactsOf(source: ExecutionFlowSource): ExecutionCardFacts {
  const { contract } = source;
  const staged = contract
    ? contractStageFacts(
        contract,
        scheduleView(contract.schedule, contract),
        contract.money && { money: contract.money, measuredWorks: contract.measuredWorks },
      )
    : null;
  return {
    boqId: source.issuedBoqId,
    contract: contract
      ? { id: contract.id, number: contract.number, createdAt: contract.createdAt, status: contract.status }
      : null,
    nextInstalment: staged?.next ?? null,
    flow: {
      stage: { hasIssuedBoq: source.issuedBoqId !== null, contract: staged?.facts ?? null },
      signingOpen: contract?.signingOpen ?? false,
      ...(staged?.counts ?? NO_FLOW_COUNTS),
    },
  };
}
