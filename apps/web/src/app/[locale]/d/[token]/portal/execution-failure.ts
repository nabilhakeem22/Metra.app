// The sentence for a refused "I've made this payment" on the Execution tab's
// payments. PURE and CLIENT-SAFE. A shared portal failure (a dead link, too
// many taps, an answer that never came, and the payments could not be read
// again) is said from `portal.errors`, as on every link page; `wrong_state`
// (the request moved on) and `not_received` (a lost answer the re-read shows
// did not land) in the row's own words. A refusal about the code is the code
// panel's (./client-code-panel.tsx).
import type { Translate } from '@/lib/actions/error-message';
import { describePortalFailure } from '@/lib/share/portal-failure';
import type { ShownClaimFailure } from './use-execution-claim';

export function describeExecutionFailure(
  failure: ShownClaimFailure,
  tErrors: Translate,
  own: (key: 'wrong_state' | 'not_received') => string,
): string {
  if (failure.error === 'wrong_state' || failure.error === 'not_received') return own(failure.error);
  return describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
}
