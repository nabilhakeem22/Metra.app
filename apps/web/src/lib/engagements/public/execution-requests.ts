// What one payment request on the client's execution card asks of the client.
// PURE and CLIENT-SAFE: the card's rows and the client home's hero read the
// same two rules, so the hero never names a request its row does not offer.
import type { PortalExecutionRequest } from './execution-types';

/** Something is still due on it (a void request is due nothing). */
export function isRequestDue(request: PortalExecutionRequest): boolean {
  return /[1-9]/.test(request.outstanding);
}

/** True when the client may say they paid it: live, something due, no claim waiting. */
export function isRequestClaimable(request: PortalExecutionRequest): boolean {
  return !request.void && request.claimedAt === null && isRequestDue(request);
}
