// Is a send or a void that got no good answer done after all, in the view the
// tab has just read (A4 L2)? PURE. When the answer was lost, or refused because
// the act already happened (`request_exists`, `request_void`), the open dialog
// says it is done instead of "try again".
import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { RequestTarget } from './send-request-dialog';

/** A live request bills the target: the schedule row is billed, or the change order is no longer waiting to be billed. */
export function requestSentFor(target: RequestTarget, view: ContractBillingView): boolean {
  if (target.kind === 'milestone') return view.schedule.some((row) => row.id === target.id && row.billed);
  return !view.variations.some((order) => order.id === target.id);
}

export function requestVoided(requestId: string, view: ContractBillingView): boolean {
  return view.requests.some((row) => row.id === requestId && row.status === 'void');
}
