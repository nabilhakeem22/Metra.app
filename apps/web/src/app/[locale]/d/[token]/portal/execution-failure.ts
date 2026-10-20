// The sentence for a refused "I made this payment" on the execution card.
// PURE and CLIENT-SAFE. A shared portal failure (a dead link, too many taps,
// an answer that never came) is said from `portal.errors`, as on every link
// page; `wrong_state` (the request moved on) and `busy` (the contract's flood
// ceiling) in the card's own words.
import type { Translate } from '@/lib/actions/error-message';
import { describePortalFailure } from '@/lib/share/portal-failure';
import type { ShownClaimFailure } from './use-execution-claim';

export function describeExecutionFailure(
  failure: ShownClaimFailure,
  tErrors: Translate,
  own: (key: 'wrong_state' | 'busy') => string,
): string {
  if (failure.error === 'wrong_state' || failure.error === 'busy') return own(failure.error);
  return describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
}
