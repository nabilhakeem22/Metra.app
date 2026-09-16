// Validating a contract header edit, and turning it into the exact set of columns
// to write. PURE — no db, no `server-only`.
//
// THE RULE THAT SHAPES THIS FILE: `undefined` means the caller did not send the
// field at all and it must be left alone; `null` means they cleared it. Nulling
// title_ar and title_en unconditionally would trip the bilingual CHECK on a save
// that never meant to touch the title, and storing an omitted retention as a zero
// would quietly rewrite a commercial term.
import type { ActionCode } from '@/lib/actions/result';
import { readMoneyString } from '@/lib/money/read';
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

/**
 * Validate the two percentages and the three dates BEFORE the transaction opens.
 *
 * `undefined` = the field was not sent. `null` back from `readMoneyString` = it
 * was sent and is unreadable. Confusing the two would store an omitted retention
 * as a refusal, or a refused one as an omission.
 */
export function validateContractHeader(
  header: ContractHeaderInput,
): ValidatedContractHeader | ActionCode {
  const retentionPct =
    header.retentionPct != null
      ? readMoneyString(header.retentionPct, { blank: '0' })
      : undefined;
  const advancePct =
    header.advancePct != null
      ? readMoneyString(header.advancePct, { blank: '0' })
      : undefined;
  if (retentionPct === null || advancePct === null) return 'invalid_percentage';
  if (retentionPct !== undefined && !isPercentInRange(retentionPct)) {
    return 'invalid_percentage';
  }
  if (advancePct !== undefined && !isPercentInRange(advancePct)) {
    return 'invalid_percentage';
  }

  const signatureDate = clean(header.signatureDate);
  const startDate = clean(header.startDate);
  const endDate = clean(header.endDate);
  for (const date of [signatureDate, startDate, endDate]) {
    if (date && !validIsoDate(date)) return 'invalid_date';
  }
  if (startDate && endDate && endDate < startDate) return 'invalid_dates';
  return { retentionPct, advancePct, signatureDate, startDate, endDate };
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
