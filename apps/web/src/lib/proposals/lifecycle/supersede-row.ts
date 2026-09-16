// The row a superseding DRAFT starts life as.
//
// PURE — no db, no `server-only`. Nothing is recomputed: a superseded proposal is
// the document the client was sent, and the revision starts from exactly what
// they saw. The studio then edits it, and THAT save is where the money engine
// runs again.
import type { proposals } from '@metra/db';

type ProposalRow = typeof proposals.$inferSelect;

/** Everything the revision inherits verbatim from the document that was sent. */
function carriedHeader(original: ProposalRow) {
  return {
    titleAr: original.titleAr,
    titleEn: original.titleEn,
    clientId: original.clientId,
    projectId: original.projectId,
    currency: original.currency,
    issueDate: original.issueDate,
    expiryDate: original.expiryDate,
    notesAr: original.notesAr,
    notesEn: original.notesEn,
    termsAr: original.termsAr,
    termsEn: original.termsEn,
  };
}

/** The frozen money the revision starts from, before the studio edits anything. */
function carriedTotals(original: ProposalRow) {
  return {
    discountPct: original.discountPct,
    taxRate: original.taxRate,
    supervisionPct: original.supervisionPct,
    subtotal: original.subtotal,
    discountAmount: original.discountAmount,
    taxableBase: original.taxableBase,
    taxAmount: original.taxAmount,
    supervisionAmount: original.supervisionAmount,
    total: original.total,
    totalCost: original.totalCost,
    totalMargin: original.totalMargin,
  };
}

export function supersedingProposalRow(
  original: ProposalRow,
  orgId: string,
  number: number,
) {
  // Listed field by field, deliberately: a spread of the original row would also
  // carry the accept/reject metadata, the token hash and the share expiry — none
  // of which a fresh DRAFT may inherit.
  return {
    orgId,
    number,
    status: 'draft' as const,
    version: original.version + 1,
    supersedesId: original.id,
    ...carriedHeader(original),
    ...carriedTotals(original),
  };
}
