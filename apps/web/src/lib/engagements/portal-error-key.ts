// Which portal error message a failed client action shows. PURE and CLIENT-SAFE.
//
// The SDF result union is shared across every tokenised surface, so it carries
// codes the delivery portal has no copy for (`already_responded`,
// `contract_inactive`). Rendering a key built from one of those would throw
// MISSING_MESSAGE in the browser; this narrows every code to one the portal
// says: a shared failure (`portal.errors`, ../share/portal-failure.ts), or
// `wrong_state`, which each act says in its own words. Each known code says
// what it means (F12); only a code nobody sent lands on `generic`, which keeps
// the server's reference when there is one.
import type { Translate } from '@/lib/actions/error-message';
import { describePortalFailure, type SharedPortalError } from '@/lib/share/portal-failure';

/** The error keys a delivery act can answer. */
export type PortalErrorKey = SharedPortalError | 'wrong_state';

/** The error side of a review act's outcome; an unknown failure carries its reference. */
export interface PortalActError {
  kind: 'error';
  error: PortalErrorKey;
  reference?: string;
}

/** Map an action's error code to a portal error key; anything unknown is generic. */
export function portalErrorKey(code: string | null | undefined): PortalErrorKey {
  switch (code) {
    case 'token_invalid':
    case 'token_expired':
    case 'not_active':
    case 'wrong_state':
    case 'too_many':
    case 'uncertain':
      return code;
    // Answered already: the act has moved on, in the act's own words.
    case 'already_responded':
      return 'wrong_state';
    // The thing the link points at is no longer open.
    case 'contract_inactive':
      return 'not_active';
    default:
      return 'generic';
  }
}

/** A failed delivery act as a page keeps it: its answer, or a promise that never answered. */
export type ShownActFailure = { error: PortalErrorKey; reference?: string } | { rejection: unknown };

/** The failure a refused act's answer carries, narrowed to a key the portal says. */
export function actFailureOf(result: { error?: string | null; reference?: string }): ShownActFailure {
  const error = portalErrorKey(result.error);
  return result.reference ? { error, reference: result.reference } : { error };
}

/** Its sentence: a shared failure from `portal.errors` (`tErrors`), `wrong_state` in the act's own words. */
export function describeActFailure(failure: ShownActFailure, tErrors: Translate, wrongState: () => string): string {
  if ('rejection' in failure) return describePortalFailure(failure, tErrors);
  if (failure.error === 'wrong_state') return wrongState();
  return describePortalFailure({ error: failure.error, reference: failure.reference }, tErrors);
}
