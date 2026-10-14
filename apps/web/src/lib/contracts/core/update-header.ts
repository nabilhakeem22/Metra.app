// Validating a contract header edit, and turning it into the exact set of columns
// to write. PURE — no db, no `server-only`.
//
// THE RULE THAT SHAPES THIS FILE: `undefined` means the caller did not send the
// field at all and it must be left alone; `null` means they cleared it. Nulling
// title_ar and title_en unconditionally would trip the bilingual CHECK on a save
// that never meant to touch the title, and storing an omitted retention as a zero
// would quietly rewrite a commercial term.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors, readMoneyField, type FieldRead } from '@/lib/validation/field-rules';
import { validIsoDate } from '@/lib/validation/iso-date';
import { isPercentInRange } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import type { ContractHeaderInput } from './update';

/** The header fields that needed validating, in the form they will be stored. */
export interface ValidatedContractHeader {
  retentionPct: string | undefined;
  advancePct: string | undefined;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Every header field stored as trimmed free text, with nothing else to decide. */
const TEXT_COLUMNS = [
  'titleAr',
  'titleEn',
  'retentionReleaseTermsAr',
  'retentionReleaseTermsEn',
  'penaltyAr',
  'penaltyEn',
  'scopeInclusionsAr',
  'scopeInclusionsEn',
  'scopeExclusionsAr',
  'scopeExclusionsEn',
  'termsAr',
  'termsEn',
] as const;

/** A percentage the caller sent (`undefined` = not sent), read inside 0 to 100. */
function readHeaderPercent(sent: string | null | undefined): FieldRead<string | undefined> {
  if (sent == null) return { ok: true, value: undefined };
  const read = readMoneyField(sent, { blank: '0' });
  if (!read.ok) return read;
  return isPercentInRange(read.value)
    ? read
    : { ok: false, error: { code: 'out_of_range', params: { min: 0, max: 100 } } };
}

const dateRefusal = (date: string | null): FieldError | null =>
  date && !validIsoDate(date) ? { code: 'invalid_date' } : null;

/**
 * Validate the two percentages and the three dates BEFORE the transaction opens,
 * every refusal at once under its field. `undefined` = the field was not sent;
 * confusing it with a refused value would store an omitted retention as a
 * refusal, or a refused one as an omission. An end before the start is said
 * under the end date: that is the one to change.
 */
export function validateContractHeader(
  header: ContractHeaderInput,
): { ok: true; value: ValidatedContractHeader } | { ok: false; errors: FieldErrors } {
  const retentionPct = readHeaderPercent(header.retentionPct);
  const advancePct = readHeaderPercent(header.advancePct);
  const signatureDate = clean(header.signatureDate);
  const startDate = clean(header.startDate);
  const endDate = clean(header.endDate);
  const endRefusal =
    dateRefusal(endDate) ??
    (startDate && endDate && endDate < startDate ? { code: 'invalid_dates' as const } : null);
  const errors = collectFieldErrors({
    retentionPct: retentionPct.ok ? null : retentionPct.error,
    advancePct: advancePct.ok ? null : advancePct.error,
    signatureDate: dateRefusal(signatureDate),
    startDate: dateRefusal(startDate),
    endDate: endRefusal,
  });
  if (!retentionPct.ok || !advancePct.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      retentionPct: retentionPct.value,
      advancePct: advancePct.value,
      signatureDate,
      startDate,
      endDate,
    },
  };
}

/** The columns to write — ONLY the ones the caller actually provided. */
export function contractHeaderPatch(
  header: ContractHeaderInput,
  validated: ValidatedContractHeader,
): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const column of TEXT_COLUMNS) {
    if (header[column] !== undefined) set[column] = clean(header[column]);
  }
  if (header.signatureDate !== undefined) set.signatureDate = validated.signatureDate;
  if (header.startDate !== undefined) set.startDate = validated.startDate;
  if (header.endDate !== undefined) set.endDate = validated.endDate;
  if (validated.retentionPct !== undefined) set.retentionPct = validated.retentionPct;
  if (validated.advancePct !== undefined) set.advancePct = validated.advancePct;
  if (header.paymentTermsDays !== undefined) {
    set.paymentTermsDays = header.paymentTermsDays;
  }
  if (header.defectsLiabilityDays !== undefined) {
    set.defectsLiabilityDays = header.defectsLiabilityDays;
  }
  // These two carry a DEFAULT rather than a passthrough: a cleared value means
  // "back to the house rule", not "store an empty string".
  if (header.advanceRecoveryMethod != null) {
    set.advanceRecoveryMethod = header.advanceRecoveryMethod.trim() || 'prorata';
  }
  if (header.paymentScheduleMode != null) {
    set.paymentScheduleMode = header.paymentScheduleMode.trim() || 'milestone';
  }
  return set;
}
