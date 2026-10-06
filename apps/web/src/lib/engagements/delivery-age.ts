// PURE and client-safe: no db, no server-only. How long a delivery has sat
// since its last change, read by the deliveries list and the dashboard panel.
// WHO holds it up is a separate rule: `whose-move.ts`, the same one the delivery
// page reads.

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
