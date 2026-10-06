/**
 * Which ROLES may fire a trigger, on top of its capability family. PURE and
 * CLIENT-SAFE (type-only imports), read by BOTH the executor, which enforces it,
 * and `canRunTrigger`, which decides whether the button is offered at all.
 *
 * The matrix has no engagement capability/action pair that grants exactly the
 * people who should decide how a delivery ends (owner decision, Oct 6: owner,
 * admin, project manager), so the endings carry a per-trigger restriction here
 * instead of the matrix changing for every other design move.
 */
import type { MemberRole } from '@/lib/permissions/roles';
import type { TransitionDef } from './types';

/** Who chooses how a delivery ends: design-only handover, or the client builds. */
export const ENDING_DECIDERS: readonly MemberRole[] = ['owner', 'admin', 'project_manager'];

/** May `role` fire this edge, as far as its per-trigger restriction goes? */
export function roleMayFire(def: Pick<TransitionDef, 'decidedBy'>, role: MemberRole): boolean {
  return def.decidedBy === undefined || def.decidedBy.includes(role);
}
