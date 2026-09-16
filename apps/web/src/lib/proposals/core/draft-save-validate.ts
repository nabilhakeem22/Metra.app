// Stage 1 of the draft save: validate + normalize the header, and reject
// oversized payloads before any DB work. Pure (no DB) — throws coded ActionErrors
// via `fail`.
//
// THE RULE THAT SHAPES THIS FILE: an omitted header field means "leave it alone",
// not "set it to zero". `undefined` is absence and `null` is "clear it", and
// collapsing the two would let a lines-only save wipe the studio's terms.
import { proposals } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import { readMoneyString } from '@/lib/money/read';
import {
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
} from '@/lib/lines/limits';
import { validIsoDate } from '@/lib/validation/iso-date';
import { isPercentInRange } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import type { SaveDraftInput, SectionInput } from './types';

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
function patched(
  sent: string | null | undefined,
  current: string | null,
): string | null {
  return sent !== undefined ? clean(sent) : current;
}

/**
 * The three percentages, each defaulting to the proposal's CURRENT value.
 *
 * Range-checked in the order discount, supervision, tax, because each has its own
 * code and a form showing two bad fields must name the same one it always did.
 */
function validateHeaderPercentages(
  proposal: ProposalRow,
  header: DraftHeader,
): { discountPct: string; taxRate: string; supervisionPct: string } {
  const discountPct = readMoneyString(header.discountPct, {
    blank: proposal.discountPct,
  });
  const taxRate = readMoneyString(header.taxRate, { blank: proposal.taxRate });
  const supervisionPct = readMoneyString(header.supervisionPct, {
    blank: proposal.supervisionPct,
  });
  if (discountPct === null || taxRate === null || supervisionPct === null) {
    fail('invalid');
  }
  if (!isPercentInRange(discountPct)) fail('discount_out_of_range');
  if (!isPercentInRange(supervisionPct)) fail('supervision_out_of_range');
  if (!isPercentInRange(taxRate)) fail('tax_out_of_range');
  return { discountPct, taxRate, supervisionPct };
}

/** The two dates, each defaulting to the proposal's current value. */
function validateHeaderDates(
  proposal: ProposalRow,
  header: DraftHeader,
): { issueDate: string | null; expiryDate: string | null } {
  const issueDate = patched(header.issueDate, proposal.issueDate);
  const expiryDate = patched(header.expiryDate, proposal.expiryDate);
  if (issueDate && !validIsoDate(issueDate)) fail('invalid_date');
  if (expiryDate && !validIsoDate(expiryDate)) fail('invalid_date');
  return { issueDate, expiryDate };
}

/** Validate + normalize the header against the proposal's current values. */
export function validateDraftHeader(
  proposal: ProposalRow,
  header: DraftHeader,
): ResolvedHeader {
  const percentages = validateHeaderPercentages(proposal, header);
  const titleEn = patched(header.titleEn, proposal.titleEn);
  const titleAr = patched(header.titleAr, proposal.titleAr);
  if (!titleEn && !titleAr) fail('name_required');
  const dates = validateHeaderDates(proposal, header);

  return {
    ...percentages,
    ...dates,
    titleEn,
    titleAr,
    currency: clean(header.currency) ?? proposal.currency,
    notesAr: patched(header.notesAr, proposal.notesAr),
    notesEn: patched(header.notesEn, proposal.notesEn),
    termsAr: patched(header.termsAr, proposal.termsAr),
    termsEn: patched(header.termsEn, proposal.termsEn),
  };
}

/** R2 boundary caps — reject oversized payloads before doing any work. */
export function enforceLineCaps(sections: SectionInput[]): void {
  if (sections.length > MAX_SECTIONS) fail('too_many_lines');
  let totalLines = 0;
  for (const section of sections) {
    if (section.lines.length > MAX_LINES_PER_SECTION) fail('too_many_lines');
    totalLines += section.lines.length;
  }
  if (totalLines > MAX_TOTAL_LINES) fail('too_many_lines');
}
