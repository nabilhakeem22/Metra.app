import type { ActionCode, ActionResult } from '@/lib/actions/result';
import type { Trigger } from './transitions';

/**
 * Which coded failures let the cockpit DROP a held idempotency key.
 *
 * The key names ONE attempt, and a retry must carry the key of the attempt it is
 * retrying — a fresh key is a fresh act and spends a second free revision or
 * writes a second attestation. So the question this answers is not "did it
 * fail?" but "do we KNOW nothing committed?".
 *
 * A coded refusal is a definite NO: every executor failure is a `fail()` inside
 * the one transaction, so the transaction rolled back and no ledger row exists.
 * Anything else — `generic` (an exception the server could not classify),
 * `uncertain` (a write deadline, a lock timeout, a dropped connection), a code
 * this list has not heard of — is AMBIGUOUS, and the safe answer is to HOLD.
 *
 * THE DEFAULT IS THE POINT. The old rule cleared on everything but `uncertain`,
 * so one unmapped SQLSTATE was enough to mint a new key mid-retry. Listing the
 * definite refusals instead makes a new ActionCode fail SAFE: holding a key that
 * could have been dropped costs nothing (no row carries it, so the next attempt
 * proceeds normally), while dropping one that should have been held is the
 * double-apply this exists to close.
 */
export const DEFINITE_REFUSALS: ReadonlySet<ActionCode> = new Set<ActionCode>([
  // Refused before the transaction even opened.
  'forbidden',
  'invalid',
  'flow_not_enabled',
  'illegal_trigger',
  // The row was not visible, or it moved under us.
  'engagement_not_found',
  'engagement_not_active',
  'engagement_state_conflict',
  'event_not_found',
  'claim_not_found',
  'boq_not_found',
  'already_corrected',
  'off_plan_locked',
  'handoff_not_open',
  'immutable',
  // Guard verdicts — pure decisions taken before the state gate.
  'transition_not_yet_enabled',
  'guard_scope_inputs_missing',
  'deposit_not_cleared',
  'gate_a_not_cleared',
  'gate_b_not_cleared',
  'balance_not_cleared',
  'revision_cos_outstanding',
  'rom_not_acknowledged',
  'as_built_not_reconciled',
  'as_built_not_due',
  'spatial_base_missing',
  'concept_options_out_of_range',
  'renders_missing',
  'shop_drawings_missing',
  'boq_missing',
  'handoff_not_acknowledged',
  // Input the side-effect refused, rolling the whole transition back.
  'design_fee_required',
  'milestone_split_invalid',
  'milestone_kind_duplicate',
  'payment_amount_invalid',
  'payment_kind_mismatch',
  'revision_co_amount_required',
  'rom_range_invalid',
  'rom_not_set',
  'rom_not_issued',
  'rom_already_issued',
  'amount_too_large',
  'invalid_date',
  'file_too_large',
]);

/** True only when the server is KNOWN to have committed nothing. */
export function isDefiniteRefusal(code: ActionCode | undefined): boolean {
  return code !== undefined && DEFINITE_REFUSALS.has(code);
}

/**
 * The keys the cockpit is still holding, by the TRIGGER each one names.
 *
 * One ref per page was wrong: fifteen call sites shared it, so uploading a file
 * or logging a payment cleared the key a half-finished `requestRevision` was
 * holding, and the retry minted a fresh one — a second ledger row and a second
 * allowance decrement, from a success that had nothing to do with it. A key
 * names one attempt at ONE act, on the client exactly as in 0050's index.
 */
export type HeldKeys = ReadonlyMap<Trigger, string>;

/**
 * The key the next attempt at `trigger` must carry: the one being retried if we
 * are still holding it, otherwise a fresh one.
 *
 * `trigger` is undefined for the edges that ignore the argument entirely — an
 * upload, a note, the off-plan toggle. Those mint a key nobody reads rather than
 * reaching into the map, so they can neither take nor release another act's key.
 */
export function keyForAttempt(
  held: HeldKeys,
  trigger: Trigger | undefined,
  mintKey: () => string,
): string {
  if (trigger === undefined) return mintKey();
  return held.get(trigger) ?? mintKey();
}

/**
 * May this result release the key it was sent with?
 *
 * Only two answers do: it worked, or the server definitely refused it. A
 * rejection ('rejected' — the request never came back) and every ambiguous code
 * HOLD, because the write may have landed and only the answer was lost.
 */
export function releasesKey(result: ActionResult | 'rejected'): boolean {
  if (result === 'rejected') return false;
  return result.ok || isDefiniteRefusal(result.error);
}
