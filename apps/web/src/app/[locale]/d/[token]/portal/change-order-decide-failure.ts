// What a refused change-order decision says in the Execution tab's section. PURE
// and CLIENT-SAFE. A refusal about the CODE (wrong, expired, locked, unknown,
// busy, a limit) is the code panel's (./use-client-code.ts) and never reaches
// here, and a missing name is the name box's. The order's online reply window
// closed is said in its own words; an order that is not the home's, or a contract
// that ended, is `wrong_state`, the page then showing where it stands; the rest
// are the shared portal failures every link page says.
import type { Translate } from '@/lib/actions/error-message';
import type { NamedCodeAnswer } from '@/lib/client-home/code-answers';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import { describePortalFailure } from '@/lib/share/portal-failure';

/** A refused decision as the section keeps it. */
export type ShownDecideFailure = ShownActFailure | { error: 'reply_closed' };

export function decideFailureOf(answer: Exclude<NamedCodeAnswer, { ok: true }>): ShownDecideFailure {
  switch (answer.error) {
    case 'link_expired':
      return { error: 'reply_closed' };
    case 'wrong_target':
    case 'contract_inactive':
      return { error: 'wrong_state' };
    default:
      return actFailureOf(answer);
  }
}

/** The refusals after which the page is read again: the order moved on, or the answer was lost. */
export function decideFailureRefreshes(failure: ShownDecideFailure): boolean {
  return failure.error === 'reply_closed' || failure.error === 'wrong_state' || failure.error === 'uncertain';
}

/** Its sentence: the section's own for the closed window and an order that moved on, `portal.errors` for the rest. */
export function describeDecideFailure(
  failure: ShownDecideFailure,
  tErrors: Translate,
  own: (key: 'replyClosed' | 'movedOn') => string,
): string {
  if (failure.error === 'reply_closed') return own('replyClosed');
  if (failure.error === 'wrong_state') return own('movedOn');
  return describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
}
