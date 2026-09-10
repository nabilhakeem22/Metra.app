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
import { MONEY_RE, clampMoney4 } from '@/lib/aggregates/proposal-totals';

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
 * Read a number the studio typed.
 *
 * Group separators come out because people type "1,500" — but anything else is
 * a REFUSAL, never a coercion. `coerceMoneyInput` reads garbage as '0', which is
 * right for an import preview (skip the bad row, show it in the problem list)
 * and wrong here: silently reading a mistyped rate as zero changes the money on
 * a document the client is going to sign, and the studio would have no way of
 * knowing it happened.
 *
 * Returns null for anything it will not accept, including a blank — a rate the
 * studio cleared is a question for the caller, not a zero.
 */
export function readNumericField(raw: string): string | null {
  // Latin digits are used in both locales (see lib/format/number.ts), so the
  // separators to strip are the ASCII ones plus the Arabic thousands mark that
  // an ar-EG keyboard can still produce.
  // The class below holds three INVISIBLE characters: U+066C (the Arabic
  // thousands separator) and the two no-break spaces a paste out of Excel carries.
  const t = raw.replace(/[\s,\u066C\u00A0\u202F]/g, '');
  if (t === '') return null;
  if (!MONEY_RE.test(t)) return null;
  // A negative quantity is a de-scope in a variation order, never a BOQ line —
  // the same rule the boq_lines_qty_non_negative CHECK enforces.
  if (t.startsWith('-')) return null;
  return clampMoney4(t);
}

export function isBoqUnit(value: string): value is BoqUnit {
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

  if (patch.itemCode !== undefined) {
    const code = (patch.itemCode ?? '').trim();
    if (code.length > MAX_ITEM_CODE) return { ok: false, error: 'item_code_too_long' };
    // An emptied code is a real edit — the line simply stops carrying one.
    value.itemCode = code === '' ? null : code;
  }

  if (patch.description !== undefined) {
    const text = patch.description.trim();
    // The bilingual CHECK demands one side be present, so a blank description is
    // not a value this table can hold.
    if (text === '') return { ok: false, error: 'description_required' };
    if (text.length > MAX_DESCRIPTION) return { ok: false, error: 'description_too_long' };
    value.description = text;
  }

  if (patch.unit !== undefined) {
    if (!isBoqUnit(patch.unit)) return { ok: false, error: 'invalid_unit' };
    value.unit = patch.unit;
  }

  if (patch.qty !== undefined) {
    const qty = readNumericField(patch.qty);
    if (qty === null) return { ok: false, error: 'invalid_qty' };
    value.qty = qty;
  }

  if (patch.unitPrice !== undefined) {
    const price = readNumericField(patch.unitPrice);
    if (price === null) return { ok: false, error: 'invalid_price' };
    value.unitPrice = price;
  }

  if (patch.provisional !== undefined) {
    if (typeof patch.provisional !== 'boolean') return { ok: false, error: 'invalid' };
    value.provisional = patch.provisional;
  }

  if (Object.keys(value).length === 0) return { ok: false, error: 'invalid' };
  return { ok: true, value };
}
