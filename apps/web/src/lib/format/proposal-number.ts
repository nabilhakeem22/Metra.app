// The ONE proposal-number formatter — imported by every UI surface AND the PDF
// template. The DB stores only the int sequence (per org); the display form is
// `Q-YYYY-NNNN`. `year` is the issue date's year, else the createdAt year.
export function formatProposalNumber(seq: number, year: number): string {
  return `Q-${year}-${String(seq).padStart(4, '0')}`;
}

/** Resolve the display year: issue date's year, else the fallback (createdAt). */
export function proposalYear(
  issueDate: string | null | undefined,
  createdAt: string | Date,
): number {
  if (issueDate) {
    const y = new Date(issueDate).getFullYear();
    if (Number.isFinite(y)) return y;
  }
  return new Date(createdAt).getFullYear();
}
