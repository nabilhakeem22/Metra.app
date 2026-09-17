import type { Trigger } from './transitions';

/**
 * ONE ATTEMPT'S IDEMPOTENCY KEY, with the instant that attempt was made.
 *
 * The key names an ATTEMPT, not a trigger and not a session: a retry must carry
 * the key of the attempt it is retrying (a fresh key is a fresh act and spends a
 * second free revision), and nothing else ever may.
 */
export interface HeldKey {
  /** The key sent with the attempt — a v4 UUID minted by the cockpit. */
  key: string;
  /**
   * When the ATTEMPT was made, epoch ms on the client clock. A retry keeps it:
   * the window below bounds the act, not the chain of retries.
   */
  heldAt: number;
}

/**
 * How long a held key may still name the attempt that minted it: FIFTEEN MINUTES.
 *
 * A9 moved the key into sessionStorage so it survives a remount, and nothing
 * bounded it: it named that trigger until the tab closed. The server treats the
 * key as proof of sameness — `payments.ts` inserts ON CONFLICT DO NOTHING and
 * returns the ORIGINAL row, `executor/self-loop.ts` short-circuits to a bare
 * `ok` with no ledger row and no side-effect — so a genuinely NEW act at the
 * same trigger hours later, in the same tab, was answered "done" and silently
 * discarded. A studio would have recorded a second payment and been told it
 * worked.
 *
 * Fifteen minutes is the window in which a studio is still dealing with the one
 * attempt they were never told the outcome of: read the refusal ("Refresh to
 * check before trying again"), refresh, look, click again. Beyond it the same
 * click is a NEW decision, and a new decision must be a new act. Much shorter
 * would cut across a genuine retry — a Worker roll plus a reload is minutes —
 * and much longer re-opens the hole, because the chance that the next click is
 * a different act grows with the gap.
 */
export const HELD_KEY_TTL_MS = 15 * 60 * 1000;

/**
 * The keys the cockpit is still holding, by the TRIGGER each one names.
 *
 * One key per page was wrong: fifteen call sites shared it, so uploading a file
 * or logging a payment cleared the key a half-finished `requestRevision` was
 * holding, and the retry minted a fresh one — a second ledger row and a second
 * allowance decrement, from a success that had nothing to do with it. A key
 * names one attempt at ONE act, on the client exactly as in 0050's index.
 */
export type HeldKeys = ReadonlyMap<Trigger, HeldKey>;

/** Is this key still inside the window in which it names an attempt in doubt? */
export function isHeldKeyLive(entry: HeldKey, now: number): boolean {
  return now - entry.heldAt <= HELD_KEY_TTL_MS;
}

/**
 * Has the attempt this key names already LANDED?
 *
 * The engagement's own ledger answers it: a transition for that trigger decided
 * AFTER the attempt was made is that attempt having committed after all, which
 * is precisely what `uncertain` could not tell the studio. The key has then done
 * its job, and the next click is a new act rather than a retry.
 *
 * Strictly NEWER, because the two instants come from two clocks — `heldAt` from
 * the browser, `decidedAt` from Postgres. Ties go to HOLDING the key: wrongly
 * holding one costs nothing (no row carries it, so the next attempt proceeds
 * normally), wrongly dropping one is the double-apply this whole module exists
 * to close.
 */
export function hasLanded(
  entry: HeldKey | undefined,
  landedAt: number | undefined,
): boolean {
  if (entry === undefined || landedAt === undefined) return false;
  return landedAt > entry.heldAt;
}

/**
 * The key the next attempt at `trigger` must carry: the one still being held for
 * an attempt in doubt, or a fresh one stamped with now.
 *
 * `trigger` is undefined for the edges that ignore the argument entirely — an
 * upload, a note, the off-plan toggle. Those mint a key nobody reads rather than
 * reaching into the map, so they can neither take nor release another act's key.
 *
 * AN EXPIRED KEY IS NOT REUSED even though it is still in the map: the map lives
 * as long as the tab, and a tab can sit open all day. See HELD_KEY_TTL_MS.
 */
export function keyForAttempt(
  held: HeldKeys,
  trigger: Trigger | undefined,
  mintKey: () => string,
  now: number,
): HeldKey {
  const entry = trigger === undefined ? undefined : held.get(trigger);
  if (entry !== undefined && isHeldKeyLive(entry, now)) return entry;
  return { key: mintKey(), heldAt: now };
}

/**
 * When each trigger last produced a transition on this engagement, epoch ms,
 * from the ledger the detail page already loaded. Feeds `hasLanded`.
 *
 * The maximum rather than the first row: the ledger is served newest-first, but
 * a rule that silently depends on someone else's ORDER BY is a rule that breaks
 * the day the query is reused.
 */
export function latestTransitionAtByTrigger(
  transitions: readonly { trigger: string | null; decidedAt: Date }[],
): Map<string, number> {
  const latest = new Map<string, number>();
  for (const transition of transitions) {
    if (transition.trigger === null) continue;
    const decidedAt = transition.decidedAt.getTime();
    const seen = latest.get(transition.trigger);
    if (seen === undefined || decidedAt > seen) latest.set(transition.trigger, decidedAt);
  }
  return latest;
}
