// Who records a client's paper answer to an issued change order (H7.3, AC 32).
// PURE and CLIENT-SAFE: the core enforces it, and the contract page asks it to
// show the change-order register and its paper button.
import { ENDING_DECIDERS } from '@/lib/engagements/transitions/trigger-roles';
import type { MemberRole } from '@/lib/permissions/roles';

/** Owner, admin or project manager: who stands in for the client's decision, as for a paper signature. */
export function mayRecordVariationDecisionOnPaper(role: MemberRole): boolean {
  return ENDING_DECIDERS.includes(role);
}
