// What a studio types for one cost entry (A15). PURE and CLIENT-SAFE: the
// Costs tab's form checks it on Save and the cores again on arrival, so the
// refusal under each box is the one the server would have sent.
//
// Two kinds of wrong input, answered differently. What a person can type wrong
// (an empty description, "abc" in a money box, a day in the future) is a field
// error under its box. What no form can send (an unknown category or unit, an
// id that is not a uuid, a number where text goes) is `malformed`: a forged
// call, not a typo.
import type { CostCategory, CostItemUnit } from '@metra/db';
import { hasFieldErrors, type FieldError, type FieldErrors } from '@/lib/actions/field-errors';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { readTypedMoney } from '@/lib/validation/amount-field';
import { collectFieldErrors, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';
import { validIsoDate } from '@/lib/validation/iso-date';
import { clean, visibleText } from '@/lib/validation/text';
import { boundedText, requiredText } from '@/lib/validation/text-field-rules';
import { NOT_UUID, optionalUuid } from '@/lib/uuid';
import { COST_ENTRY_CATEGORIES, EARLIEST_COST_DAY } from './types';

export const COST_ENTRY_FIELDS = [
  'category',
  'description',
  'amount',
  'incurredOn',
  'contractSectionId',
  'contractLineId',
  'qty',
  'unit',
  'unitCost',
  'supplier',
  'reference',
  'costItemId',
] as const;

export type CostEntryField = (typeof COST_ENTRY_FIELDS)[number];

/** The description's cap, and the supplier's and reference's: the table's CHECKs. */
export const MAX_COST_DESCRIPTION_CHARS = 300;
export const MAX_COST_PARTY_CHARS = 120;

/** Zero, or a figure so small it stores as 0.0000: said with the range a box takes (the smallest kept is 0.0001). */
const POSITIVE_RANGE: FieldError = { code: 'out_of_range', params: { min: '0.0001', max: '1,000,000,000,000' } };

/** The entry as typed. Directly invokable, so anything may arrive. */
export interface TypedCostEntry {
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  incurredOn?: unknown;
  contractSectionId?: unknown;
  contractLineId?: unknown;
  qty?: unknown;
  unit?: unknown;
  unitCost?: unknown;
  supplier?: unknown;
  reference?: unknown;
  costItemId?: unknown;
}

/** The entry as stored: trimmed text, canonical scale-4 money, null for every blank. */
export interface CleanCostEntry {
  category: CostCategory;
  description: string;
  amount: string;
  incurredOn: string;
  contractSectionId: string | null;
  contractLineId: string | null;
  qty: string | null;
  unit: CostItemUnit | null;
  unitCost: string | null;
  supplier: string | null;
  reference: string | null;
  costItemId: string | null;
}

export type CostEntryRead =
  | { ok: true; values: CleanCostEntry }
  | { ok: false; malformed: true }
  | { ok: false; malformed: false; errors: FieldErrors<CostEntryField> };

const TYPED_FIELDS = ['description', 'amount', 'incurredOn', 'qty', 'unitCost', 'supplier', 'reference'] as const;

const MALFORMED: CostEntryRead = { ok: false, malformed: true };

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A read figure in the stored form, four decimals ("5" as "5.0000"). */
const canonical = (value: string) => formatMoney4(parseMoney4(value));

/** A unit from the price book's list, null when none was chosen, undefined when it is no unit at all. */
function readUnit(value: unknown): CostItemUnit | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return UNIT_TOKENS.find((unit) => unit === value);
}

/** A money box that must hold more than zero; empty is `required`. */
function readPositive(raw: string | null): FieldRead<string> {
  if (clean(raw) === null) return { ok: false, error: { code: 'required' } };
  const read = readTypedMoney(raw);
  if (!read.ok) return read;
  return parseMoney4(read.value) > 0n ? { ok: true, value: canonical(read.value) } : { ok: false, error: POSITIVE_RANGE };
}

/** A real day from EARLIEST_COST_DAY to today: year 0000 (which Postgres refuses) or 1999 is `invalid_date`. */
function readIncurredOn(raw: string | null, today: string): FieldRead<string> {
  const value = clean(raw);
  if (value === null) return { ok: false, error: { code: 'required' } };
  if (!validIsoDate(value) || value < EARLIEST_COST_DAY) return { ok: false, error: { code: 'invalid_date' } };
  return value > today ? { ok: false, error: { code: 'date_in_future' } } : { ok: true, value };
}

/** Quantity, unit and unit cost come together or not at all: each one left out of a started three is required. */
function readQuantity(qtyRaw: string | null, unit: CostItemUnit | null, unitCostRaw: string | null) {
  if (clean(qtyRaw) === null && unit === null && clean(unitCostRaw) === null) {
    return { qty: null, unitCost: null, errors: { qty: null, unit: null, unitCost: null } };
  }
  const qty = readPositive(qtyRaw);
  const unitCost = clean(unitCostRaw) === null ? null : readTypedMoney(unitCostRaw);
  return {
    qty: qty.ok ? qty.value : null,
    unitCost: unitCost?.ok ? canonical(unitCost.value) : null,
    errors: {
      qty: qty.ok ? null : qty.error,
      unit: unit === null ? ({ code: 'required' } as const) : null,
      unitCost: unitCost === null ? ({ code: 'required' } as const) : unitCost.ok ? null : unitCost.error,
    },
  };
}

/** `today` is the Cairo day as `YYYY-MM-DD`: no cost is incurred after it. */
export function readCostEntry(input: TypedCostEntry, today: string): CostEntryRead {
  const category = COST_ENTRY_CATEGORIES.find((known) => known === input.category);
  const sectionId = optionalUuid(input.contractSectionId);
  const lineId = optionalUuid(input.contractLineId);
  const costItemId = optionalUuid(input.costItemId);
  const unit = readUnit(input.unit);
  const typed = TYPED_FIELDS.every((field) => input[field] === undefined || input[field] === null || typeof input[field] === 'string');
  if (!category || !typed || unit === undefined) return MALFORMED;
  if (sectionId === NOT_UUID || lineId === NOT_UUID || costItemId === NOT_UUID) return MALFORMED;

  // Invisible characters alone (a bidi mark, a zero-width joiner) are a blank description.
  const description = visibleText(text(input.description));
  const amount = readPositive(text(input.amount));
  const incurredOn = readIncurredOn(text(input.incurredOn), today);
  const quantity = readQuantity(text(input.qty), unit, text(input.unitCost));
  const supplier = readOptionalText(text(input.supplier), MAX_COST_PARTY_CHARS);
  const reference = readOptionalText(text(input.reference), MAX_COST_PARTY_CHARS);
  const errors = collectFieldErrors<CostEntryField>({
    category: null,
    description: requiredText(description) ?? boundedText(description, MAX_COST_DESCRIPTION_CHARS),
    amount: amount.ok ? null : amount.error,
    incurredOn: incurredOn.ok ? null : incurredOn.error,
    // A line is booked within its section, so a line names its section too.
    contractSectionId: lineId !== null && sectionId === null ? { code: 'required' } : null,
    contractLineId: null,
    ...quantity.errors,
    supplier: supplier.ok ? null : supplier.error,
    reference: reference.ok ? null : reference.error,
    costItemId: null,
  });
  // Every failed read is in `errors`; the second half narrows the reads for the type checker.
  if (hasFieldErrors(errors) || description === null || !amount.ok || !incurredOn.ok || !supplier.ok || !reference.ok) {
    return { ok: false, malformed: false, errors };
  }
  return {
    ok: true,
    values: {
      category,
      description,
      amount: amount.value,
      incurredOn: incurredOn.value,
      contractSectionId: sectionId,
      contractLineId: lineId,
      qty: quantity.qty,
      unit,
      unitCost: quantity.unitCost,
      supplier: supplier.value,
      reference: reference.value,
      costItemId,
    },
  };
}

/** The form's pre-check: the same rules, as the refusals under each box (a malformed shape has none to show). */
export function costEntryFieldErrors(input: TypedCostEntry, today: string): FieldErrors<CostEntryField> {
  const read = readCostEntry(input, today);
  return read.ok || read.malformed ? {} : read.errors;
}
