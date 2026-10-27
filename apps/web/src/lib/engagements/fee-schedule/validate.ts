import { MILESTONE_BASES, MILESTONE_KINDS, type MilestoneBasis, type MilestoneKind } from '@metra/db';
import type { FieldError } from '@/lib/actions/field-errors';
import type { ActionCode } from '@/lib/actions/result';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { isRecord } from '@/lib/guards/is-record';
import { readPositiveAmount, readTypedMoney } from '@/lib/validation/amount-field';

/** 100.0000 in scale-4 units (the required sum of a percent split). */
const HUNDRED_PERCENT_4 = parseMoney4('100');

/** A validated, canonical milestone row ready to insert. */
interface ValidatedMilestone {
  kind: MilestoneKind;
  basis: MilestoneBasis;
  value: string;
  sortOrder: number;
}

interface ValidatedFeeSchedule {
  designFee: string;
  milestones: ValidatedMilestone[];
}

/** The fee form's two boxes a refusal can sit under: the fee, and the split. */
export type FeeScheduleField = 'designFee' | 'milestones';

type FeeScheduleValidation =
  | { ok: true; schedule: ValidatedFeeSchedule }
  | { ok: false; code: ActionCode; field?: undefined }
  | { ok: false; field: FeeScheduleField; error: FieldError };

const FEE_MISSING: FieldError = { code: 'design_fee_required' };
const FEE_REQUIRED = { ok: false, field: 'designFee', error: FEE_MISSING } as const;
const SPLIT_INVALID = { ok: false, field: 'milestones', error: { code: 'milestone_split_invalid' } } as const;

/** A split value: a typed money figure at scale 4, never below zero; null when not one. */
function splitValue4(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const read = readTypedMoney(value);
  return read.ok ? parseMoney4(read.value) : null;
}

const KIND_SET = new Set<string>(MILESTONE_KINDS);
const BASIS_SET = new Set<string>(MILESTONE_BASES);

/** A milestone as read from the payload, before canonicalisation. */
type ParsedMilestone = { kind: MilestoneKind; basis: MilestoneBasis; value4: bigint };

type MilestoneRead =
  | { ok: true; bases: Set<MilestoneBasis>; parsed: ParsedMilestone[] }
  | Extract<FeeScheduleValidation, { ok: false }>;

/**
 * Every raw milestone read in order, or the first refusal: shape, kind, basis,
 * value, a repeated kind, then a split with no `deposit` milestone.
 */
function readMilestones(milestones: unknown[]): MilestoneRead {
  const seenKinds = new Set<MilestoneKind>();
  const bases = new Set<MilestoneBasis>();
  const parsed: ParsedMilestone[] = [];
  for (const raw of milestones) {
    if (!isRecord(raw)) return SPLIT_INVALID;
    const { kind, basis, value } = raw;
    if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
      return SPLIT_INVALID;
    }
    if (typeof basis !== 'string' || !BASIS_SET.has(basis)) {
      return SPLIT_INVALID;
    }
    const value4 = splitValue4(value);
    if (value4 === null) return SPLIT_INVALID;

    const kindTyped = kind as MilestoneKind;
    if (seenKinds.has(kindTyped)) {
      return { ok: false, code: 'milestone_kind_duplicate' };
    }
    seenKinds.add(kindTyped);
    bases.add(basis as MilestoneBasis);
    parsed.push({ kind: kindTyped, basis: basis as MilestoneBasis, value4 });
  }

  if (!seenKinds.has('deposit')) {
    return SPLIT_INVALID;
  }
  return { ok: true, bases, parsed };
}

/** Canonicalize: stable kind order (deposit, gate_a, gate_b, balance) as sortOrder. */
function canonicalMilestones(parsed: ParsedMilestone[]): ValidatedMilestone[] {
  const kindOrder = new Map<MilestoneKind, number>(
    MILESTONE_KINDS.map((k, i) => [k, i]),
  );
  return parsed
    .map((m) => ({
      kind: m.kind,
      basis: m.basis,
      value: formatMoney4(m.value4),
      sortOrder: kindOrder.get(m.kind) ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Validate a fee-schedule payload with exact scale-4 BigInt math. Rules:
 *  - `designFee` is a typed amount > 0 (amount-field.ts)          → design_fee_required,
 *    or not_a_number / amount_too_large when it is typed but unreadable
 *  - at least one milestone, and a `deposit` milestone is present → milestone_split_invalid
 *  - every `value` is a well-formed money string ≥ 0             → milestone_split_invalid
 *  - a `kind` may appear at most once                            → milestone_kind_duplicate
 *  - all milestones share ONE basis (no mixing)                  → milestone_split_invalid
 *  - basis=percent: Σ percent = exactly 100.0000                 → milestone_split_invalid
 *  - basis=amount:  Σ amount  = designFee to the piastre         → milestone_split_invalid
 * On success returns canonical (scale-4, kind-ordered) rows to persist. The two
 * codes the fee form can fix carry the box they belong under (`field`).
 */
export function validateFeeSchedule(payload: unknown): FeeScheduleValidation {
  if (!isRecord(payload)) return FEE_REQUIRED;

  const { designFee, milestones } = payload;

  const fee = readPositiveAmount(designFee, FEE_MISSING);
  if (!fee.ok) return { ok: false, field: 'designFee', error: fee.error };
  const designFee4 = parseMoney4(fee.value);

  if (!Array.isArray(milestones) || milestones.length === 0) {
    return SPLIT_INVALID;
  }

  const read = readMilestones(milestones);
  if (!read.ok) return read;
  const { bases, parsed } = read;

  // A schedule may not mix percent and amount milestones.
  if (bases.size !== 1) return SPLIT_INVALID;
  const basis = [...bases][0];

  const sum4 = parsed.reduce((acc, m) => acc + m.value4, 0n);
  const target4 = basis === 'percent' ? HUNDRED_PERCENT_4 : designFee4;
  if (sum4 !== target4) return SPLIT_INVALID;

  return {
    ok: true,
    schedule: { designFee: formatMoney4(designFee4), milestones: canonicalMilestones(parsed) },
  };
}
