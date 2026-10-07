import 'server-only';
// Stage 3 of the draft save: write down what the earlier stages decided. Nothing
// here validates or computes anything.
import {
  proposalLines,
  proposalSections,
  proposals,
  type MetraDb,
} from '@metra/db';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import type { ResolvedHeader } from './draft-save-validate';
import { proposalRevision } from '../revision';
import type { ResolvedSection } from './draft-save-resolve';
import type { DraftSaveReceipt } from './types';

/**
 * Replace the document's sections and lines: delete, then batch-insert the
 * resolved ones (subtotal precomputed). The cascade takes the old lines with the
 * old sections.
 *
 * THE DELETE IS UNCONDITIONAL, and that is the point: a save that sends NO
 * sections must EMPTY the document, not leave the previous ones standing.
 *
 * Every row's id is decided HERE, before the inserts (a kept line id, else a
 * fresh uuid), so the receipt names each stored row in the order it was sent
 * without trusting the order RETURNING happens to give.
 */
export async function replaceDraftSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  resolvedSections: ResolvedSection[],
): Promise<DraftSaveReceipt['sections']> {
  await tx
    .delete(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  if (!resolvedSections.length) return [];
  const stored = resolvedSections.map((section) => ({
    id: randomUUID(),
    lineIds: section.lines.map((line) => line.id ?? randomUUID()),
  }));
  await tx.insert(proposalSections).values(
    resolvedSections.map((section, index) => ({
      id: stored[index].id,
      orgId,
      proposalId,
      titleAr: section.titleAr,
      titleEn: section.titleEn,
      sortOrder: section.sortOrder,
      sectionSubtotal: section.subtotal,
    })),
  );
  const lineRows = resolvedSections.flatMap((section, index) =>
    section.lines.map((line, lineIndex) => ({
      ...line,
      id: stored[index].lineIds[lineIndex],
      orgId,
      proposalId,
      sectionId: stored[index].id,
    })),
  );
  await insertLinesInChunks(tx, proposalLines, lineRows);
  return stored;
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

/**
 * Stamp the normalized header and the recomputed document totals, RE-ASSERTING
 * the draft gate — as `variations/core/update-persist.ts persistVariationHeader`
 * does, and as this statement did not.
 *
 * A draft save racing a send is a NORMAL race: the loser blocked on the send's
 * row lock, then `trg_proposals_immutable` raised MT100 and rolled the whole
 * transaction back. Correct, but MT100 is not a code `mutationFailureCode`
 * classifies, so the studio was answered `generic` — "something went wrong" —
 * and a `console.error('mutateInOrg failed:')` went into the log for a race the
 * product expects. Gating the UPDATE answers `proposal_not_draft`, which the
 * catalogue already has in both languages, and writes no false defect line.
 *
 * Returns the proposal's new revision token (../revision.ts).
 */
export async function persistDraftHeaderAndTotals(
  tx: MetraDb,
  proposalId: string,
  header: ResolvedHeader,
  totals: DocTotals,
): Promise<string> {
  const saved = await tx
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
      // Database clock, not JS Date: the Send-as-BOQ revision is updated_at in
      // microseconds, and a millisecond Date would let two saves share one.
      updatedAt: sql`clock_timestamp()`,
    })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, 'draft')))
    .returning({ revision: proposalRevision });
  if (!saved[0]) fail('proposal_not_draft');
  return saved[0].revision;
}
