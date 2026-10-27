// What a refused signing says in the Execution tab's contract section. PURE
// and CLIENT-SAFE. A refusal about the CODE (wrong, spent, expired, locked,
// unknown, busy, a limit) is the code panel's (./use-client-code.ts) and never
// reaches here, and a missing name is the name box's. The online signing
// window closed is said in its own words; a contract that is not the home's
// any more (replaced, ended), or a link that shows none to sign (revoked,
// expired, no longer at execution: the server's snapshot read answers first,
// `contract_inactive`), is `wrong_state`, the page then showing where it
// stands; the rest are the shared portal failures every link page says.
import type { Translate } from '@/lib/actions/error-message';
import type { SignContractAnswer } from '@/lib/client-home/code-answers';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import { describePortalFailure } from '@/lib/share/portal-failure';

/** A refused signing as the section keeps it. */
export type ShownSignFailure = ShownActFailure | { error: 'signing_closed' };

export function signFailureOf(answer: Exclude<SignContractAnswer, { ok: true }>): ShownSignFailure {
  switch (answer.error) {
    case 'signing_closed':
      return { error: 'signing_closed' };
    case 'wrong_target':
    case 'contract_inactive':
      return { error: 'wrong_state' };
    default:
      return actFailureOf(answer);
  }
}

/** The refusals after which the page is read again: the contract moved on, or the answer was lost. */
export function signFailureRefreshes(failure: ShownSignFailure): boolean {
  return failure.error === 'signing_closed' || failure.error === 'wrong_state' || failure.error === 'uncertain';
}

/** Its sentence: the section's own for the closed window and a contract that moved on, `portal.errors` for the rest. */
export function describeSignFailure(
  failure: ShownSignFailure,
  tErrors: Translate,
  own: (key: 'signingClosed' | 'movedOn') => string,
): string {
  if (failure.error === 'signing_closed') return own('signingClosed');
  if (failure.error === 'wrong_state') return own('movedOn');
  return describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
}
