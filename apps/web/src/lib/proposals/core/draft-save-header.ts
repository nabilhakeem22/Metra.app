// Stage 1 of the draft save: the header, read against the proposal's current
// values. Pure (no DB): it answers the header as stored, or every refusal under
// the field it is about (D1), so the builder can say all of them at once.
//
// THE RULE THAT SHAPES THIS FILE: an omitted header field means "leave it alone",
// not "set it to zero". `undefined` is absence and `null` is "clear it", and
// collapsing the two would let a lines-only save wipe the studio's terms.
import type { proposals } from '@metra/db';
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import type { ActionCode } from '@/lib/actions/result';
import { validIsoDate } from '@/lib/validation/iso-date';
import { isPercentInRange } from '@/lib/validation/percent';
import { readMoneyField, type FieldRead } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import type { SaveDraftInput } from './types';

type ProposalRow = typeof proposals.$inferSelect;
type DraftHeader = NonNullable<SaveDraftInput['header']>;

export interface ResolvedHeader {
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  titleEn: string | null;
  titleAr: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  currency: string;
  notesAr: string | null;
  notesEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
}

/** An omitted field keeps the proposal's current value; a sent one is trimmed. */
function patched(sent: string | null | undefined, current: string | null): string | null {
  return sent !== undefined ? clean(sent) : current;
}

/** One percentage, defaulting to the proposal's CURRENT value, inside 0 to 100. */
function readPercent(sent: string | null | undefined, current: string, outOfRange: ActionCode): FieldRead<string> {
  const read = readMoneyField(sent, { blank: current });
  if (!read.ok) return read;
  return isPercentInRange(read.value) ? read : { ok: false, error: { code: outOfRange } };
}

const dateError = (date: string | null): FieldError | null =>
  date && !validIsoDate(date) ? { code: 'invalid_date' } : null;

/** The header as it will be stored, or every refusal under its field. */
export function readDraftHeader(
  proposal: ProposalRow,
  header: DraftHeader,
): { ok: true; header: ResolvedHeader } | { ok: false; errors: FieldErrors } {
  const discountPct = readPercent(header.discountPct, proposal.discountPct, 'discount_out_of_range');
  const supervisionPct = readPercent(header.supervisionPct, proposal.supervisionPct, 'supervision_out_of_range');
  const taxRate = readPercent(header.taxRate, proposal.taxRate, 'tax_out_of_range');
  const titleEn = patched(header.titleEn, proposal.titleEn);
  const titleAr = patched(header.titleAr, proposal.titleAr);
  const issueDate = patched(header.issueDate, proposal.issueDate);
  const expiryDate = patched(header.expiryDate, proposal.expiryDate);

  const errors: Record<string, FieldError> = {};
  if (!discountPct.ok) errors.discountPct = discountPct.error;
  if (!supervisionPct.ok) errors.supervisionPct = supervisionPct.error;
  if (!taxRate.ok) errors.taxRate = taxRate.error;
  if (!titleEn && !titleAr) errors.title = { code: 'name_required' };
  const issueError = dateError(issueDate);
  const expiryError = dateError(expiryDate);
  if (issueError) errors.issueDate = issueError;
  if (expiryError) errors.expiryDate = expiryError;
  if (!discountPct.ok || !supervisionPct.ok || !taxRate.ok || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    header: {
      discountPct: discountPct.value,
      supervisionPct: supervisionPct.value,
      taxRate: taxRate.value,
      titleEn,
      titleAr,
      issueDate,
      expiryDate,
      currency: clean(header.currency) ?? proposal.currency,
      notesAr: patched(header.notesAr, proposal.notesAr),
      notesEn: patched(header.notesEn, proposal.notesEn),
      termsAr: patched(header.termsAr, proposal.termsAr),
      termsEn: patched(header.termsEn, proposal.termsEn),
    },
  };
}
