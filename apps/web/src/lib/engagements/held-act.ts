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

/** What a held key can be filed under: a lifecycle trigger, or a money control. */
export type HeldKeyTrigger =
  | Trigger
  | typeof PAYMENT_HELD_TRIGGER
  | typeof PAY_AND_ADVANCE_HELD_TRIGGER;

/**
 * How much of one field's value takes part in naming the act. Every value the
 * server can accept here is far shorter (a scale-4 money string, a reference, a
 * method); the cap exists because these fields are free text, the result is
 * mirrored to sessionStorage, and a pasted essay should not be carried there.
 * Two inputs can only collide past the cap if both are refused anyway.
 */
const MAX_ACT_FIELD_CHARS = 40;

/**
 * WHAT THIS ACT IS, from the values being submitted.
 *
 * Pass EVERY field the request carries. A field left out is a field two attempts
 * may differ in while the cockpit calls them the same act — and the same act is
 * answered by the server with the FIRST attempt's row, so the second write is
 * discarded and the studio is told it worked.
 *
 * Sorted by name, and JSON rather than a joined string: the result must not
 * depend on the literal order the caller happened to write the object in, and a
 * value containing the separator must not be able to impersonate another field.
 */
export function actFrom(fields: Record<string, string | null | undefined>): string {
  const named = Object.keys(fields)
    .sort()
    .map((name) => [name, (fields[name] ?? '').slice(0, MAX_ACT_FIELD_CHARS)]);
  return JSON.stringify(named);
}
