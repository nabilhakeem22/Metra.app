// What the Execution tab's hero offers for each client reason, the request it
// names, and the tone of whose move it is FROM THE CLIENT'S SIDE. PURE and
// CLIENT-SAFE. The reason itself is the locator's (lib/flow/locate/
// execution-client.ts); this only turns it into the one act the hero offers.
import { isRequestClaimable } from '@/lib/engagements/public/execution-requests';
import type { PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import type { ClientExecutionLocation, ClientExecutionReason } from '@/lib/flow/locate/execution-client';
import type { StatusTone } from '@/lib/ui/status-tone';
import type { HomeExecution } from './types';

/** The sections of the Execution tab an act can open, by their element id. */
type HomeSection = 'contract' | 'change-orders' | 'payments';

/** The hero's one act: open a section of the tab, or write to the studio on WhatsApp. */
type HeroAct = { kind: 'section'; section: HomeSection; label: 'reviewContract' | 'reviewChangeOrder' | 'howToPay' } | { kind: 'whatsapp' };

/** Total over the reasons, so a new reason does not compile until it says what the hero offers. */
const REASON_ACT: Readonly<Record<ClientExecutionReason, HeroAct | null>> = {
  preparing_contract: null,
  sign_contract: { kind: 'section', section: 'contract', label: 'reviewContract' },
  signing_closed: { kind: 'whatsapp' },
  decide_change_order: { kind: 'section', section: 'change-orders', label: 'reviewChangeOrder' },
  pay_request: { kind: 'section', section: 'payments', label: 'howToPay' },
  payment_being_confirmed: null,
  works_in_progress: null,
  final_account_due: { kind: 'section', section: 'payments', label: 'howToPay' },
  final_account_in_review: null,
  settled: null,
  terminated: null,
};

export function heroAct(reason: ClientExecutionReason): HeroAct | null {
  return REASON_ACT[reason];
}

/**
 * The request the hero names: the OLDEST one still due and unclaimed when the
 * client is asked to pay (the final account first once it is due), the NEWEST
 * pending claim while the studio checks one. Null when the card's list (the
 * newest 60) holds none of them; the hero then says the same without a number.
 */
export function heroRequest(execution: HomeExecution): PortalExecutionRequest | null {
  const requests = execution.money?.requests ?? [];
  const oldestFirst = [...requests].reverse();
  switch (execution.location.reason) {
    case 'pay_request':
      return oldestFirst.find(isRequestClaimable) ?? null;
    case 'final_account_due':
      return oldestFirst.find((request) => isRequestClaimable(request) && request.target.kind === 'final_account') ?? null;
    case 'payment_being_confirmed':
      return requests.find((request) => !request.void && request.claimedAt !== null) ?? null;
    default:
      return null;
  }
}

/** Whose move it is, as the client reads it: theirs is the brand "your move"; the studio's and the site's are waiting. */
export function clientMoveTone(location: ClientExecutionLocation): StatusTone {
  if (location.status === 'complete') return 'done';
  if (location.status === 'closed' || location.whoseMove === null) return 'neutral';
  return location.whoseMove === 'client' ? 'yourMove' : 'waiting';
}

/** The chip's words: the move's holder, or the phase's end. */
export function clientMoveKey(location: ClientExecutionLocation): 'client' | 'studio' | 'site' | 'done' | 'closed' {
  if (location.status === 'complete') return 'done';
  if (location.status === 'closed' || location.whoseMove === null) return 'closed';
  return location.whoseMove;
}
