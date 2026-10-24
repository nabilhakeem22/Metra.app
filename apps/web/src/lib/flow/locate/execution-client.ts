// Where a delivery is in the EXECUTION phase, for the client. PURE and
// CLIENT-SAFE. The client page knows less than the studio (no BOQ, no draft
// contract, no balance), so it has its own reason list, read from the facts the
// client home receives. The first reason that holds wins.
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { ExecutionStepKey } from '../phases/execution';
import type { StepLocation } from '../types';

export const CLIENT_EXECUTION_REASONS = [
  'preparing_contract',
  'sign_contract',
  'signing_closed',
  'decide_change_order',
  'pay_request',
  'payment_being_confirmed',
  'works_in_progress',
  'final_account_due',
  'settled',
  'terminated',
] as const;

export type ClientExecutionReason = (typeof CLIENT_EXECUTION_REASONS)[number];

/** One payment request as the client page lists it (the fields this locator reads). */
export interface ClientPaymentRequestFacts {
  target: { kind: 'milestone' | 'variation' | 'final_account' };
  /** What is still due, a scale-4 string; zero on a void request. */
  outstanding: string;
  void: boolean;
  /** When the client's "I paid" was sent and is still unanswered; else null. */
  claimedAt: string | null;
}

/** What the client home knows about the execution phase. */
export interface ClientExecutionFacts {
  /** The contract the client can see; null while the studio is still preparing it. */
  contract: { status: 'issued' | 'signed' | 'terminated'; signingOpen: boolean } | null;
  /** Change orders issued to the client and not yet decided. */
  openVariationCount: number;
  /** The payment requests; null when none can be shown yet. */
  money: { requests: readonly ClientPaymentRequestFacts[] } | null;
}

export type ClientExecutionLocation = StepLocation<ExecutionStepKey> & { reason: ClientExecutionReason };

const REASON_PLACE: Readonly<Record<ClientExecutionReason, StepLocation<ExecutionStepKey>>> = {
  preparing_contract: { step: 'contract', whoseMove: 'studio', status: 'active' },
  sign_contract: { step: 'signature', whoseMove: 'client', status: 'active' },
  signing_closed: { step: 'signature', whoseMove: 'studio', status: 'active' },
  decide_change_order: { step: 'works', whoseMove: 'client', status: 'active' },
  pay_request: { step: 'works', whoseMove: 'client', status: 'active' },
  payment_being_confirmed: { step: 'works', whoseMove: 'studio', status: 'active' },
  works_in_progress: { step: 'works', whoseMove: 'site', status: 'active' },
  final_account_due: { step: 'final_account', whoseMove: 'client', status: 'active' },
  settled: { step: 'settled', whoseMove: null, status: 'complete' },
  terminated: { step: null, whoseMove: null, status: 'closed' },
};

const isDue = (request: ClientPaymentRequestFacts): boolean =>
  !request.void && parseMoney4(request.outstanding) > 0n;

/** After the contract is signed: decisions first, then money, then the end state. */
function signedReason(facts: ClientExecutionFacts): ClientExecutionReason {
  if (facts.openVariationCount > 0) return 'decide_change_order';
  const requests = facts.money?.requests ?? [];
  const unclaimedDue = requests.filter((request) => isDue(request) && request.claimedAt === null);
  if (unclaimedDue.some((request) => request.target.kind === 'final_account')) return 'final_account_due';
  if (unclaimedDue.length > 0) return 'pay_request';
  if (requests.some((request) => isDue(request) && request.claimedAt !== null)) return 'payment_being_confirmed';
  // Nothing is due or waiting here, so an issued final account is fully paid.
  const finalAccountIssued = requests.some((request) => !request.void && request.target.kind === 'final_account');
  return finalAccountIssued ? 'settled' : 'works_in_progress';
}

export function clientExecutionReason(facts: ClientExecutionFacts): ClientExecutionReason {
  const { contract } = facts;
  if (contract === null) return 'preparing_contract';
  switch (contract.status) {
    case 'terminated':
      return 'terminated';
    case 'issued':
      return contract.signingOpen ? 'sign_contract' : 'signing_closed';
    case 'signed':
      return signedReason(facts);
  }
}

export function locateExecutionForClient(facts: ClientExecutionFacts): ClientExecutionLocation {
  const reason = clientExecutionReason(facts);
  return { ...REASON_PLACE[reason], reason };
}
