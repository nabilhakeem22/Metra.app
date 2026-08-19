// The ONE document-number formatter — imported by every UI surface AND the PDF
// templates. The DB stores only the int sequence (per org); the display form is
// `<PREFIX>-YYYY-NNNN` (Q=quote/proposal, C=contract, VO=variation order).
// PURE (no server/db imports) so it stays client-safe. Per-org sequence
// allocation lives in the server-only ./allocate-number module, not here.
export type DocPrefix = 'Q' | 'C' | 'VO';

export function formatDocNumber(
  prefix: DocPrefix,
  seq: number,
  year: number,
): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

/** Resolve the display year: issue date's year, else the fallback (createdAt). */
export function docYear(
  issueDate: string | null | undefined,
  createdAt: string | Date,
): number {
  if (issueDate) {
    const y = new Date(issueDate).getFullYear();
    if (Number.isFinite(y)) return y;
  }
  return new Date(createdAt).getFullYear();
}
