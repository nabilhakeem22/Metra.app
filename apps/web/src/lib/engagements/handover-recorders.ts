// Who may record that the client received the design-only handover package
// (owner decision, Oct 9). Recording it now closes the delivery, irreversibly
// (handover-close.ts), so it is the same people who decide how a delivery ends
// and who may record an approval the client gave offline: owner, admin, project
// manager. PURE and CLIENT-SAFE: the server core enforces it before any read, and
// the delivery page uses it to decide who sees the control.
import type { MemberRole } from '@/lib/permissions/roles';
import { ENDING_DECIDERS } from './transitions/trigger-roles';

export const HANDOVER_CONFIRMATION_RECORDERS: readonly MemberRole[] = ENDING_DECIDERS;

export function mayRecordHandoverConfirmation(role: MemberRole): boolean {
  return HANDOVER_CONFIRMATION_RECORDERS.includes(role);
}
