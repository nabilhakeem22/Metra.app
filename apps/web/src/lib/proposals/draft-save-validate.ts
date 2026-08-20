// Stage 1 of the draft save: validate + normalize the header, and reject
// oversized payloads before any DB work. Pure (no DB) — throws coded ActionErrors
// via `fail`.
import { proposals } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import {
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
  normalizeMoney,
  normalizeText,
  pctInRange,
  validIsoDate,
  type SaveDraftInput,
  type SectionInput,
} from './core';

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

/** Validate + normalize the header against the proposal's current values. */
export function validateDraftHeader(
  proposal: ProposalRow,
  header: DraftHeader,
): ResolvedHeader {
  const discountPct = normalizeMoney(header.discountPct, proposal.discountPct);
  const taxRate = normalizeMoney(header.taxRate, proposal.taxRate);
  const supervisionPct = normalizeMoney(
    header.supervisionPct,
    proposal.supervisionPct,
  );
  if (discountPct === null || taxRate === null || supervisionPct === null) {
    fail('invalid');
  }
  if (!pctInRange(discountPct!)) fail('discount_out_of_range');
  if (!pctInRange(supervisionPct!)) fail('supervision_out_of_range');
  const titleEn =
    header.titleEn !== undefined ? normalizeText(header.titleEn) : proposal.titleEn;
  const titleAr =
    header.titleAr !== undefined ? normalizeText(header.titleAr) : proposal.titleAr;
  if (!titleEn && !titleAr) fail('name_required');

  const issueDate =
    header.issueDate !== undefined
      ? normalizeText(header.issueDate)
      : proposal.issueDate;
  const expiryDate =
    header.expiryDate !== undefined
      ? normalizeText(header.expiryDate)
      : proposal.expiryDate;
  if (issueDate && !validIsoDate(issueDate)) fail('invalid_date');
  if (expiryDate && !validIsoDate(expiryDate)) fail('invalid_date');

  return {
    discountPct: discountPct!,
    taxRate: taxRate!,
    supervisionPct: supervisionPct!,
    titleEn,
    titleAr,
    issueDate,
    expiryDate,
    currency: normalizeText(header.currency) ?? proposal.currency,
    notesAr:
      header.notesAr !== undefined ? normalizeText(header.notesAr) : proposal.notesAr,
    notesEn:
      header.notesEn !== undefined ? normalizeText(header.notesEn) : proposal.notesEn,
    termsAr:
      header.termsAr !== undefined ? normalizeText(header.termsAr) : proposal.termsAr,
    termsEn:
      header.termsEn !== undefined ? normalizeText(header.termsEn) : proposal.termsEn,
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
