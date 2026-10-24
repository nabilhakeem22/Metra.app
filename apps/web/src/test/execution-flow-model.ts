// TEST-ONLY. A delivery's execution as a small model (the contract, up to three
// payment requests, the change orders, the schedule and the balance) and the
// ONE fact set both execution locators read, built from it the way the studio
// query and the client home's SQL count them. `executionModels` walks every
// model a real contract can be in, so a property can be checked over all of
// them (lib/flow/locate/execution-projections.test.ts).
import { formatMoney4 } from '@/lib/aggregates/proposal-totals';
import type { ExecutionContractFacts } from '@/lib/execution/stage';
import type { ExecutionFlowFacts } from '@/lib/flow/locate/execution-facts';

export type ModelRequestKind = 'milestone' | 'variation' | 'final_account';
export type ModelRequestState = 'due' | 'claimed' | 'paid' | 'void' | 'partial' | 'partialClaimed';
export interface ModelRequest {
  kind: ModelRequestKind;
  state: ModelRequestState;
}

export type ModelContract =
  | 'no_boq'
  | 'no_contract'
  | 'draft_unscheduled'
  | 'draft'
  | 'issued_open'
  | 'issued_closed'
  | 'signed'
  | 'terminated';

export interface ExecutionModel {
  contract: ModelContract;
  requests: readonly ModelRequest[];
  issuedChangeOrders: number;
  internalChangeOrders: number;
  unbilledChangeOrders: number;
  /** A schedule row is left to bill, and it fits in the balance. */
  nextMilestone: boolean;
  /** Something is left to bill (both balances). */
  balanceLeft: boolean;
}

const MODEL_CONTRACTS: readonly ModelContract[] = [
  'no_boq',
  'no_contract',
  'draft_unscheduled',
  'draft',
  'issued_open',
  'issued_closed',
  'signed',
  'terminated',
];
const REQUEST_KINDS: readonly ModelRequestKind[] = ['milestone', 'variation', 'final_account'];
const REQUEST_STATES: readonly ModelRequestState[] = ['due', 'claimed', 'paid', 'void', 'partial', 'partialClaimed'];

const OUTSTANDING: Readonly<Record<ModelRequestState, bigint>> = {
  due: 10_000_000n,
  claimed: 10_000_000n,
  paid: 0n,
  void: 0n,
  partial: 4_000_000n,
  partialClaimed: 4_000_000n,
};

const isLive = (request: ModelRequest) => request.state !== 'void';
const isUnpaid = (request: ModelRequest) => isLive(request) && OUTSTANDING[request.state] > 0n;
const isClaimed = (request: ModelRequest) => request.state === 'claimed' || request.state === 'partialClaimed';

const EMPTY_MODEL: ExecutionModel = {
  contract: 'signed',
  requests: [],
  issuedChangeOrders: 0,
  internalChangeOrders: 0,
  unbilledChangeOrders: 0,
  nextMilestone: false,
  balanceLeft: false,
};

/** A signed contract, nothing owed either way, with the overrides. */
export function model(overrides: Partial<ExecutionModel> = {}): ExecutionModel {
  return { ...EMPTY_MODEL, ...overrides };
}

const CONTRACT_STATUS = {
  draft_unscheduled: 'draft',
  draft: 'draft',
  issued_open: 'issued',
  issued_closed: 'issued',
  signed: 'signed',
  terminated: 'terminated',
} as const;

/** The money facts of a signed contract; any other contract bills nothing (queries/facts.ts). */
function contractFacts(m: ExecutionModel, status: ExecutionContractFacts['status']): ExecutionContractFacts {
  const idle: ExecutionContractFacts = {
    status,
    scheduleValid: m.contract !== 'draft_unscheduled',
    nextUnbilledMilestone: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 0,
    openVariationCount: 0,
    billingBalance: '0.0000',
    finalAccountBalance: '0.0000',
  };
  if (status !== 'signed') return idle;
  const unpaid = m.requests.filter(isUnpaid);
  const finalAccount = m.requests.find((request) => isLive(request) && request.kind === 'final_account');
  const balance = m.balanceLeft ? '1000.0000' : '0.0000';
  return {
    ...idle,
    nextUnbilledMilestone: m.nextMilestone ? { id: 'row-1', amount: '1000.0000' } : null,
    pendingClaimCount: unpaid.filter(isClaimed).length,
    unbilledVariationCount: m.unbilledChangeOrders,
    finalAccountOutstanding: finalAccount ? formatMoney4(OUTSTANDING[finalAccount.state]) : null,
    unpaidRequestCount: unpaid.length,
    openVariationCount: m.issuedChangeOrders + m.internalChangeOrders,
    billingBalance: balance,
    finalAccountBalance: balance,
  };
}

/** The one fact set both locators read, as the studio query and the client SQL count it. */
export function flowFactsOf(m: ExecutionModel): ExecutionFlowFacts {
  if (m.contract === 'no_boq' || m.contract === 'no_contract') {
    return {
      stage: { hasIssuedBoq: m.contract === 'no_contract', contract: null },
      signingOpen: false,
      issuedChangeOrderCount: 0,
      unclaimedDueRequestCount: 0,
    };
  }
  const contract = contractFacts(m, CONTRACT_STATUS[m.contract]);
  const signed = contract.status === 'signed';
  return {
    stage: { hasIssuedBoq: true, contract },
    signingOpen: m.contract === 'issued_open',
    issuedChangeOrderCount: signed ? m.issuedChangeOrders : 0,
    unclaimedDueRequestCount: signed ? m.requests.filter((request) => isUnpaid(request) && !isClaimed(request)).length : 0,
  };
}

/** Every list of up to `max` requests, each request any kind in any state. */
function requestLists(max: number): ModelRequest[][] {
  const singles = REQUEST_KINDS.flatMap((kind) => REQUEST_STATES.map((state) => ({ kind, state })));
  const lists: ModelRequest[][] = [[]];
  let previous: ModelRequest[][] = [[]];
  for (let length = 1; length <= max; length += 1) {
    previous = previous.flatMap((list) => singles.map((single) => [...list, single]));
    lists.push(...previous);
  }
  return lists;
}

/**
 * A model a real contract can be in: one live final account at most, issued
 * only once nothing is left on the schedule and no change order is open (the
 * final account core refuses otherwise); a next milestone always fits in the
 * balance; money and change orders only on a signed or terminated contract.
 */
function isReachable(m: ExecutionModel): boolean {
  if (m.nextMilestone && !m.balanceLeft) return false;
  const billing = m.contract === 'signed' || m.contract === 'terminated';
  const changes = m.issuedChangeOrders + m.internalChangeOrders + m.unbilledChangeOrders;
  if (!billing && (m.requests.length > 0 || changes > 0 || m.nextMilestone || m.balanceLeft)) return false;
  const finalAccounts = m.requests.filter((request) => isLive(request) && request.kind === 'final_account').length;
  if (finalAccounts > 1) return false;
  return finalAccounts === 0 || (!m.nextMilestone && m.issuedChangeOrders + m.internalChangeOrders === 0);
}

/** Every reachable model with up to `maxRequests` requests. */
export function* executionModels(maxRequests: number): Generator<ExecutionModel> {
  const lists = requestLists(maxRequests);
  for (const contract of MODEL_CONTRACTS) {
    const billing = contract === 'signed' || contract === 'terminated';
    for (const requests of billing ? lists : [[]]) {
      for (const issuedChangeOrders of [0, 1, 2]) {
        for (const internalChangeOrders of [0, 1]) {
          for (const unbilledChangeOrders of [0, 1]) {
            for (const nextMilestone of [false, true]) {
              for (const balanceLeft of [false, true]) {
                const m = { contract, requests, issuedChangeOrders, internalChangeOrders, unbilledChangeOrders, nextMilestone, balanceLeft };
                if (isReachable(m)) yield m;
              }
            }
          }
        }
      }
    }
  }
}
