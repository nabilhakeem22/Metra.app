import 'server-only';
// Stage 3 of the draft save: write down what the earlier stages decided. Nothing
// here validates or computes anything.
import {
  proposalLines,
  proposalSections,
  proposals,
  type MetraDb,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import type { ResolvedHeader } from './draft-save-validate';
import type { ResolvedSection } from './draft-save-resolve';

/**
 * Replace the document's sections and lines: delete, then batch-insert the
 * resolved ones (subtotal precomputed). The cascade takes the old lines with the
 * old sections.
 *
 * THE DELETE IS UNCONDITIONAL, and that is the point: a save that sends NO
 * sections must EMPTY the document, not leave the previous ones standing.
 */
export async function replaceDraftSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  resolvedSections: ResolvedSection[],
): Promise<void> {
  await tx
    .delete(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  if (!resolvedSections.length) return;
  const sectionIds = await insertDraftSections(
    tx,
    orgId,
    proposalId,
    resolvedSections,
  );
  const lineRows = resolvedSections.flatMap((section, index) =>
    section.lines.map((line) => ({
      orgId,
      proposalId,
      sectionId: sectionIds[index],
      ...line,
    })),
  );
  await insertLinesInChunks(tx, proposalLines, lineRows);
}

/**
 * ONE insert for every section, returning their new ids IN INPUT ORDER — which is
 * what lets the lines below be pointed at their section by index rather than by a
 * second query each.
 */
async function insertDraftSections(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  resolvedSections: ResolvedSection[],
): Promise<string[]> {
  const rows = await tx
    .insert(proposalSections)
    .values(
      resolvedSections.map((section) => ({
        orgId,
        proposalId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.subtotal,
      })),
    )
    .returning({ id: proposalSections.id });
  return rows.map((row) => row.id);
}

/** The nine money columns the engine recomputed. Never a client-supplied one. */
function totalsColumns(totals: DocTotals) {
  return {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxableBase: totals.taxableBase,
    taxAmount: totals.taxAmount,
    supervisionAmount: totals.supervisionAmount,
    total: totals.total,
    totalCost: totals.totalCost,
    totalMargin: totals.totalMargin,
  };
}

/** Stamp the normalized header and the recomputed document totals. */
export async function persistDraftHeaderAndTotals(
  tx: MetraDb,
  proposalId: string,
  header: ResolvedHeader,
  totals: DocTotals,
): Promise<void> {
  await tx
    .update(proposals)
    .set({
      titleAr: header.titleAr,
      titleEn: header.titleEn,
      issueDate: header.issueDate,
      expiryDate: header.expiryDate,
      currency: header.currency,
      notesAr: header.notesAr,
      notesEn: header.notesEn,
      termsAr: header.termsAr,
      termsEn: header.termsEn,
      discountPct: header.discountPct,
      taxRate: header.taxRate,
      supervisionPct: header.supervisionPct,
      ...totalsColumns(totals),
      updatedAt: new Date(),
    })
    .where(eq(proposals.id, proposalId));
}
