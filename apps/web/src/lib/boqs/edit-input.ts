// PURE and client-safe: no db, no next/*, no server-only. Split out of edit.ts
// for the same reason bilingual.ts was split out of core.ts — the cores reach
// server-only dependencies and this repo deliberately does not stub those in the
// unit suite.
//
// The SHEET validates with these functions before it posts and the CORES
// validate with the same ones before they write. A cell the browser accepted is
// then never refused by the server for a reason the browser could have given
// first, and a request that skips the browser entirely still cannot write a
// value the browser would have rejected.

import type { ActionCode } from '@/lib/actions/result';
import { readMoney } from '@/lib/money/read';
import { countCharacters } from '@/lib/validation/text';

/**
 * Metra's units, in the order the picker offers them. Mirrors the
 * `cost_item_unit` enum; edit-input.test.ts fails if the two ever drift, which
 * is what lets this list live in a client-safe module instead of being imported
 * from the database package.
 */
export const BOQ_UNITS = [
  'sqm',
  'linear_meter',
  'pcs',
  'lump_sum',
  'day',
] as const;
export type BoqUnit = (typeof BOQ_UNITS)[number];

/** Item codes are studio references ("2.03.1"), not identifiers Metra parses. */
export const MAX_ITEM_CODE = 40;
export const MAX_DESCRIPTION = 500;

/** What the sheet may send for one line. Absent key = leave that column alone. */
export interface BoqLinePatch {
  itemCode?: string | null;
  description?: string;
  unit?: string;
  qty?: string;
  unitPrice?: string;
  provisional?: boolean;
}

/** The same patch, validated and normalized to what the column stores. */
export interface CleanLinePatch {
  itemCode?: string | null;
  description?: string;
  unit?: BoqUnit;
  qty?: string;
  unitPrice?: string;
  provisional?: boolean;
}

export type PatchResult =
  | { ok: true; value: CleanLinePatch }
  | { ok: false; error: ActionCode };

/**
 * A number the studio TYPED into the sheet.
 *
 * Group separators come out because people type "1,500" — but anything else is
 * a REFUSAL, never a coercion. `coerceMoneyInput` reads garbage as '0', which is
 * right for an import preview (skip the bad row, show it in the problem list)
 * and wrong here: silently reading a mistyped rate as zero changes the money on
 * a document the client is going to sign, and the studio would have no way of
 * knowing it happened. No blank either — a rate the studio CLEARED is a question
 * for the caller, not a zero. And no negative: that is a variation-order
 * de-scope, never a BOQ line (the boq_lines_qty_non_negative CHECK agrees).
 */
const TYPED_FIELD = { allowGroupSeparators: true } as const;

type FieldResult = { value: string } | { error: ActionCode };

/**
 * A quantity or a rate: readable, non-negative, and inside the magnitude cap.
 *
 * The cap is MAX_AMOUNT (1e12) and the reader applies it, so a pasted 1e17 is
 * refused here — the sheet was once the one money surface that let such a factor
 * through to the arithmetic, where its product overflows numeric(18,4) and the
 * write fails as a raw 22003. It is refused with `amount_too_large` rather than
 * `invalid_qty`: the studio can see that 1e17 is a number, and being told it is
 * not one is both wrong and unactionable. The PRODUCTS are still checked
 * separately by the caller, which is the case no per-factor check could catch.
 */
function readAmountField(raw: string, ifUnreadable: ActionCode): FieldResult {
  const result = readMoney(raw, TYPED_FIELD);
  if (result.ok) return { value: result.value };
  return { error: result.reason === 'too_large' ? 'amount_too_large' : ifUnreadable };
}

function isBoqUnit(value: string): value is BoqUnit {
  return (BOQ_UNITS as readonly string[]).includes(value);
}

/**
 * Validate one line patch.
 *
 * An EMPTY patch is refused rather than treated as a no-op write: it means the
 * caller believed it was changing something, and answering "ok" to that hides
 * whichever bug produced it.
 */
export function normalizeLinePatch(patch: BoqLinePatch): PatchResult {
  const value: CleanLinePatch = {};
  const textError = readTextFields(patch, value);
  if (textError) return { ok: false, error: textError };
  const amountError = readAmountFields(patch, value);
  if (amountError) return { ok: false, error: amountError };

  if (patch.provisional !== undefined) {
    if (typeof patch.provisional !== 'boolean') return { ok: false, error: 'invalid' };
    value.provisional = patch.provisional;
  }

  if (Object.keys(value).length === 0) return { ok: false, error: 'invalid' };
  return { ok: true, value };
}

/** The columns that hold text: code, description, unit. Null = all accepted. */
function readTextFields(
  patch: BoqLinePatch,
  value: CleanLinePatch,
): ActionCode | null {
  if (patch.itemCode !== undefined) {
    const code = (patch.itemCode ?? '').trim();
    if (code.length > MAX_ITEM_CODE) return 'item_code_too_long';
    // An emptied code is a real edit — the line simply stops carrying one.
    value.itemCode = code === '' ? null : code;
  }

  if (patch.description !== undefined) {
    const text = patch.description.trim();
    // The bilingual CHECK demands one side be present, so a blank description is
    // not a value this table can hold.
    if (text === '') return 'description_required';
    if (countCharacters(text) > MAX_DESCRIPTION) return 'description_too_long';
    value.description = text;
  }

  if (patch.unit !== undefined) {
    if (!isBoqUnit(patch.unit)) return 'invalid_unit';
    value.unit = patch.unit;
  }
  return null;
}

/** The columns that hold money: quantity and rate. Null = both accepted. */
function readAmountFields(
  patch: BoqLinePatch,
  value: CleanLinePatch,
): ActionCode | null {
  if (patch.qty !== undefined) {
    const qty = readAmountField(patch.qty, 'invalid_qty');
    if ('error' in qty) return qty.error;
    value.qty = qty.value;
  }

  if (patch.unitPrice !== undefined) {
    const price = readAmountField(patch.unitPrice, 'invalid_price');
    if ('error' in price) return price.error;
    value.unitPrice = price.value;
  }
  return null;
}
