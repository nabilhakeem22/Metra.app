import type { Trigger } from './transitions';

/**
 * WHAT A HELD IDEMPOTENCY KEY IS FILED UNDER, and what makes two attempts the
 * same act. `held-key.ts` owns how long a key speaks for; this owns its NAME.
 *
 * The server reads a repeated key as proof of sameness — `payments.ts` inserts
 * ON CONFLICT DO NOTHING and returns the ORIGINAL row with `ok`,
 * `executor/self-loop.ts` short-circuits to a bare `ok` — so "the same act" is a
 * question the cockpit has to answer exactly, and in two parts: which CONTROL
 * was used, and with WHICH INPUTS.
 */

/** The name a payment recorded from the Payments tab holds its key under. */
export const PAYMENT_HELD_TRIGGER = 'recordPayment';

/**
 * ...and the name the hero's combined "Log payment & advance" uses. A SECOND
 * name rather than sharing the payment one: the map holds one entry per name, so
 * two controls sharing a name means whichever is used second overwrites the key
 * the first is still holding for an attempt in doubt — the wave-5 F1 defect, in
 * miniature. Neither is one of the 19 lifecycle triggers (a payment appends to
 * `payment_events`); both are asserted absent from TRANSITIONS by held-act.test.
 */
export const PAY_AND_ADVANCE_HELD_TRIGGER = 'logPaymentAndAdvance';

/** The CONTROL a held key belongs to: a lifecycle trigger, or a money control. */
export type HeldKeyTrigger =
  | Trigger
  | typeof PAYMENT_HELD_TRIGGER
  | typeof PAY_AND_ADVANCE_HELD_TRIGGER;

declare const heldKeySlotBrand: unique symbol;

/**
 * WHERE ONE ATTEMPT'S KEY IS FILED: the control AND the act, together.
 *
 * ONE ENTRY PER ACT, not one per control. While the map held one entry per
 * CONTROL, a second act at the same control overwrote the entry the first was
 * still holding — and a definite refusal on that second act then deleted the
 * slot outright, so the studio's retry of the first act (an attempt nobody knew
 * the outcome of, well inside its TTL) went out under a FRESH identity. If the
 * first attempt had committed, that retry is a second EGP row in an append-only
 * ledger. Typing a figure wrong between an in-doubt attempt and its retry was
 * enough to reach it.
 *
 * Branded so a bare trigger cannot be handed to the map by mistake.
 */
export type HeldKeySlot = string & { readonly [heldKeySlotBrand]: true };

/**
 * SEPARATES THE CONTROL FROM THE ACT in a slot, and is the version marker.
 *
 * No trigger name contains it, so the control is everything before the FIRST
 * one and nothing has to parse the act (which is opaque). An entry read back
 * WITHOUT it was written by the build that filed one entry per control: its act
 * is inside the value rather than in the name, and it is dropped rather than
 * adopted — see held-keys-store.ts.
 */
export const HELD_KEY_SLOT_SEPARATOR = '|';

/** Where the key for this attempt at `trigger`, with these inputs, is filed. */
export function heldKeySlot(trigger: HeldKeyTrigger, act?: string): HeldKeySlot {
  return `${trigger}${HELD_KEY_SLOT_SEPARATOR}${act ?? ''}` as HeldKeySlot;
}

/**
 * FNV-1a over the UTF-8 bytes, 64-bit, as sixteen hex characters.
 *
 * NOT a truncation, which is what this replaced: the act used to be the first 40
 * characters of each value, and the server accepts 200 for `reference` and
 * `method` — so two wire references from one bank on one day
 * (`…BRANCH-014-SEQ-0001` and `…-0002`) were ONE act, and the second payment was
 * answered with the first one's row. A hash reads every character and is short
 * whatever the input, which is what the cap was really for.
 *
 * NOT cryptographic, and does not need to be: it distinguishes a handful of acts
 * inside one tab inside fifteen minutes, and the consequence of the collision it
 * cannot have is a retry being recognised. FNV-1a is four lines and no
 * dependency. A side effect worth having: the amount the studio typed is no
 * longer mirrored into sessionStorage in the clear.
 */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const SIXTY_FOUR_BITS = 0xffffffffffffffffn;

function fnv1a64(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & SIXTY_FOUR_BITS;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * WHAT THIS ACT IS, from the values being submitted.
 *
 * Pass EVERY field the request carries. A field left out is a field two attempts
 * may differ in while the cockpit calls them the same act — and the same act is
 * answered by the server with the FIRST attempt's row, so the second write is
 * discarded and the studio is told it worked.
 *
 * The canonical form hashed here is sorted by field name and JSON, so the result
 * cannot depend on the order the caller wrote the object in and no value can
 * impersonate another field by containing a separator.
 */
export function actFrom(fields: Record<string, string | null | undefined>): string {
  const named = Object.keys(fields)
    .sort()
    .map((name) => [name, fields[name] ?? '']);
  return fnv1a64(JSON.stringify(named));
}
