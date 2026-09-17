import type { HeldKeySlot } from './held-act';

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
 * The keys the cockpit is still holding, BY SLOT — one entry per ACT.
 *
 * One key per PAGE was wrong: fifteen call sites shared it, so uploading a file
 * cleared the key a half-finished `requestRevision` was holding and the retry
 * minted a fresh one. One key per CONTROL was wrong for the same reason one step
 * down: a second act at that control evicted the first. A key names one attempt
 * at ONE act, on the client exactly as in 0050's index. See held-act.ts.
 */
export type HeldKeys = ReadonlyMap<HeldKeySlot, HeldKey>;

/** Is this key still inside the window in which it names an attempt in doubt? */
export function isHeldKeyLive(entry: HeldKey, now: number): boolean {
  return now - entry.heldAt <= HELD_KEY_TTL_MS;
}

/**
 * Has the attempt this key names already LANDED?
 *
 * IDENTITY, NOT TIME: the engagement's own ledger answers it by carrying THIS
 * key. The keys are opaque UUIDs minted by this client, so a transition row
 * holding one IS that attempt having committed — precisely what `uncertain`
 * could not tell the studio. The key has then done its job and the next click is
 * a new act rather than a retry.
 *
 * NO CLOCKS, deliberately. This used to compare `heldAt` (the BROWSER) against
 * the newest `decidedAt` at that trigger (POSTGRES) and drop any key that looked
 * older, so a laptop running behind the server threw away a LIVE key and the
 * retry of an attempt that had already committed went out as a new act — caused
 * by the mechanism meant to prevent it. Skew cannot be assumed away on a studio
 * machine, so the TTL (one clock, measuring an interval against itself) is the
 * only time-based rule left here.
 *
 * Only edges that PERSIST a key are recognisable this way — 0050 stores it on
 * self-loops — and those are exactly the edges where a replayed key decides
 * anything (`executor/self-loop.ts` short-circuits on one). Every other edge is
 * guarded by its own admission gate, whatever key it carries.
 */
export function hasLanded(
  entry: HeldKey | undefined,
  landedKeys: ReadonlySet<string> | undefined,
): boolean {
  if (entry === undefined || landedKeys === undefined) return false;
  return landedKeys.has(entry.key);
}

/**
 * The key the next attempt in `slot` must carry: the one still being held for an
 * attempt in doubt, or a fresh one stamped with now.
 *
 * The slot is undefined for the edges that ignore the argument entirely — an
 * upload, a note, the off-plan toggle. Those mint a key nobody reads rather than
 * reaching into the map, so they can neither take nor release another act's key.
 *
 * AN EXPIRED KEY IS NOT REUSED even though it is still in the map: the map lives
 * as long as the tab, and a tab can sit open all day. See HELD_KEY_TTL_MS. A key
 * held for a DIFFERENT act is not reused either, and needs no check here — a
 * different act is a different SLOT, and this one only ever reads its own.
 */
export function keyForAttempt(
  held: HeldKeys,
  slot: HeldKeySlot | undefined,
  mintKey: () => string,
  now: number,
): HeldKey {
  const entry = slot === undefined ? undefined : held.get(slot);
  if (entry !== undefined && isHeldKeyLive(entry, now)) return entry;
  return { key: mintKey(), heldAt: now };
}

/**
 * Every idempotency key this engagement's own records already carry, from what
 * the detail page has loaded. Feeds `hasLanded`.
 *
 * TWO LEDGERS, because the acts that hold keys write to two: the transition
 * ledger (self-loop edges) and `payment_events` (both money controls). While
 * only transitions were folded in, a payment could never be recognised as
 * landed — so a studio who did exactly what the `uncertain` copy says (refresh,
 * look, and only then decide) still had their next, deliberate payment answered
 * with the first one's row.
 *
 * Order does not matter and neither does the trigger a row names: the key alone
 * identifies the attempt. A row carrying no key contributes nothing.
 */
export function landedKeysOf(
  ...ledgers: readonly (readonly { idempotencyKey: string | null }[])[]
): Set<string> {
  const landed = new Set<string>();
  for (const ledger of ledgers) {
    for (const row of ledger) {
      if (row.idempotencyKey !== null) landed.add(row.idempotencyKey);
    }
  }
  return landed;
}
