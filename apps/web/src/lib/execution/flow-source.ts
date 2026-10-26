// The shapes of the two execution fact statements of packages/db
// rls/functions/65-execution-facts.sql, read into TypeScript: the money facts
// of one contract (`app_contract_money_facts`) and everything a delivery's
// execution facts are derived from (`app_execution_flow_source`). PURE: the
// studio reads the statements in its org transaction, the client home through
// its token function, and both hand the JSON here, so the two sides parse ONE
// shape (lib/flow/locate/execution-facts.ts: one fact model, two projections).
import type { ContractStatus, MilestoneBasis } from '@metra/db';
import type { StoredScheduleRow } from '@/lib/contracts/schedule/queries';

export interface ContractMoneyFacts {
  pendingClaimCount: number;
  unpaidRequestCount: number;
  /** Issued requests with something still due and no pending "I paid" claim on them. */
  unclaimedDueRequestCount: number;
  openVariationCount: number;
  /** Of the open change orders, the ones issued to the client whose link is still live. */
  issuedVariationCount: number;
  /** Of the open change orders, the ones issued to the client whose link has expired. */
  expiredVariationCount: number;
  /** Approved change orders that add money and have no issued request. */
  unbilledVariationCount: number;
  /** Σ amount of every ISSUED request (void ones are not billed). */
  issuedRequestsTotal: string;
  approvedVariationNetDeltas: string[];
  /** The schedule rows an issued request already bills. */
  billedMilestoneIds: string[];
  /**
   * The issued final account request: what is still due on it, and the final
   * value it billed up to (itself plus every request issued before it, a
   * request voided after it included, so a void under it reopens the balance).
   */
  finalAccount: { outstanding: string; finalValue: string } | null;
}

/** The delivery's contract, as the fact source names it, with what its stage is derived from. */
interface FlowSourceContract {
  id: string;
  number: number;
  /** ISO instant. */
  createdAt: string;
  status: ContractStatus;
  /** Issued, and its online signing window (OD7) still open. */
  signingOpen: boolean;
  originalValue: string;
  taxAmount: string;
  taxRate: string;
  supervisionPct: string;
  discountPct: string;
  schedule: StoredScheduleRow[];
  /** A signed contract's money facts; null before it is signed. */
  money: ContractMoneyFacts | null;
  /** The measured works of a signed contract with no final account issued; null otherwise. */
  measuredWorks: string | null;
}

export interface ExecutionFlowSource {
  /** The newest issued BOQ the delivery owns: what "create contract" generates from. */
  issuedBoqId: string | null;
  contract: FlowSourceContract | null;
}

type MoneyFactsJson = {
  pending_claims: number;
  unpaid_requests: number;
  unclaimed_due_requests: number;
  open_variations: number;
  issued_variations: number;
  expired_variations: number;
  unbilled_variations: number;
  issued_total: string;
  approved_deltas: string[];
  billed_milestones: string[];
  final_account: { outstanding: string; final_value: string } | null;
};

type ScheduleRowJson = {
  id: string;
  label_ar: string | null;
  label_en: string | null;
  basis: MilestoneBasis;
  value: string;
  sort_order: number;
};

type ContractJson = {
  id: string;
  number: number;
  created_at: string;
  status: ContractStatus;
  signing_open: boolean;
  original_value: string;
  tax_amount: string;
  tax_rate: string;
  supervision_pct: string;
  discount_pct: string;
  schedule: ScheduleRowJson[];
  money: MoneyFactsJson | null;
  measured_works: string | null;
};

type FlowSourceJson = { issued_boq_id: string | null; contract: ContractJson | null };

/** `app_contract_money_facts`'s JSON as the money module reads it. */
export function contractMoneyFactsOf(json: unknown): ContractMoneyFacts {
  const facts = json as MoneyFactsJson;
  return {
    pendingClaimCount: facts.pending_claims,
    unpaidRequestCount: facts.unpaid_requests,
    unclaimedDueRequestCount: facts.unclaimed_due_requests,
    openVariationCount: facts.open_variations,
    issuedVariationCount: facts.issued_variations,
    expiredVariationCount: facts.expired_variations,
    unbilledVariationCount: facts.unbilled_variations,
    issuedRequestsTotal: facts.issued_total,
    approvedVariationNetDeltas: facts.approved_deltas,
    billedMilestoneIds: facts.billed_milestones,
    finalAccount: facts.final_account
      ? { outstanding: facts.final_account.outstanding, finalValue: facts.final_account.final_value }
      : null,
  };
}

function scheduleRowOf(row: ScheduleRowJson): StoredScheduleRow {
  return {
    id: row.id,
    labelAr: row.label_ar,
    labelEn: row.label_en,
    basis: row.basis,
    value: row.value,
    sortOrder: row.sort_order,
  };
}

function contractOf(contract: ContractJson): FlowSourceContract {
  return {
    id: contract.id,
    number: contract.number,
    createdAt: new Date(contract.created_at).toISOString(),
    status: contract.status,
    signingOpen: contract.signing_open,
    originalValue: contract.original_value,
    taxAmount: contract.tax_amount,
    taxRate: contract.tax_rate,
    supervisionPct: contract.supervision_pct,
    discountPct: contract.discount_pct,
    schedule: contract.schedule.map(scheduleRowOf),
    money: contract.money ? contractMoneyFactsOf(contract.money) : null,
    measuredWorks: contract.measured_works,
  };
}

/** `app_execution_flow_source`'s JSON; it is never null for a delivery the caller can see. */
export function executionFlowSourceOf(json: unknown): ExecutionFlowSource {
  if (json === null || typeof json !== 'object') {
    throw new Error('app_execution_flow_source answered no delivery');
  }
  const source = json as FlowSourceJson;
  return {
    issuedBoqId: source.issued_boq_id,
    contract: source.contract ? contractOf(source.contract) : null,
  };
}
