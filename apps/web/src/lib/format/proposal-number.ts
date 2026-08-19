// Proposal-number formatting, expressed via the shared doc-number formatter.
// The DB stores only the int sequence (per org); the display form is `Q-YYYY-NNNN`.
// Kept as a thin, named surface so the many existing proposal call sites (UI +
// PDF) stay stable while the formatter itself is generalized in ./doc-number.
import { docYear, formatDocNumber } from './doc-number';

/** `Q-YYYY-NNNN` — the proposal (quote) display number. */
export function formatProposalNumber(seq: number, year: number): string {
  return formatDocNumber('Q', seq, year);
}

/** Resolve the display year: issue date's year, else the fallback (createdAt). */
export function proposalYear(
  issueDate: string | null | undefined,
  createdAt: string | Date,
): number {
  return docYear(issueDate, createdAt);
}
