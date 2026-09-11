// PURE and client-safe: no db, no server-only. The dashboard's delivery panel
// and its unit test both import from here.
//
// What this module decides is small but load-bearing: for each in-flight
// delivery, WHO is holding it up and HOW LONG it has sat. Everything else the
// panel shows (stage position, gate) comes from `stage-spine.ts`, which the
// delivery page already ships — the dashboard reuses that reading rather than
// inventing a second notion of progress.

import type { DesignState } from '@/lib/engagements/states';

/**
 * States where the ball is in the CLIENT's court.
 *
 * Deliberately a short, defensible list rather than a guess per state:
 *
 *   - `concept_review` and `final_approval` are the two GATE states. Sitting at
 *     a gate means the design work is done and an approval or an instalment is
 *     not — by construction the studio cannot move until the client does.
 *   - `change_triage` is the detour off `final_approval` and still owes Gate B.
 *   - `execution_decision` is the client choosing whether to build.
 *   - `design_only_handoff` is waiting on the handoff acknowledgement.
 *
 * Everything else that is still active is the studio's move. That inference is
 * sound because the engagement is in flight and is not blocked on the client, so
 * the only party who can advance it is the firm.
 *
 * `negotiation` is NOT here, and that is the same trap the spine hit: the only
 * edge into it is `selectConcept`, whose sole guard is the Gate A instalment, so
 * being in it PROVES the money cleared. Revisions are the studio's work.
 */
const WAITING_ON_CLIENT = new Set<DesignState>([
  'concept_review',
  'final_approval',
  'change_triage',
  'execution_decision',
  'design_only_handoff',
]);

export type WaitingOn = 'client' | 'studio';

export function deliveryWaitingOn(state: DesignState): WaitingOn {
  return WAITING_ON_CLIENT.has(state) ? 'client' : 'studio';
}

/**
 * Whole days between two instants, floored, never negative.
 *
 * A clock skew or a row stamped a second into the future should read "today",
 * not "-1 days" — the panel is a triage aid, and a negative age would make the
 * sort look broken rather than the data.
 */
export function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  const ms = now.getTime() - then;
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * When a delivery has sat long enough to call out.
 *
 * A week: long enough that it is not simply "nobody worked on it over the
 * weekend", short enough to still be actionable. It only changes how the figure
 * is COLOURED — the sort already puts the oldest first, so nothing is hidden by
 * picking this threshold wrong.
 */
export const STALE_AFTER_DAYS = 7;

export function isStale(days: number): boolean {
  return days >= STALE_AFTER_DAYS;
}
