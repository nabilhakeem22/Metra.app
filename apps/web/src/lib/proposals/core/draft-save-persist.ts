import 'server-only';
// Stage 3 of the draft save: write down what the earlier stages decided. Nothing
// here validates or computes anything.
import {
  proposalLines,
  proposalSections,
  proposals,
  type MetraDb,
} from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import { updateRowsInChunks } from '@/lib/lines/update-chunked';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import type { ResolvedHeader } from './draft-save-validate';
import { proposalRevision } from '../revision';
import { LINE_COLUMNS, SECTION_COLUMNS, type DraftWritePlan } from './draft-save-diff';

const SECTION_COLUMN_KEYS = Object.keys(SECTION_COLUMNS) as (keyof typeof SECTION_COLUMNS)[];
const LINE_COLUMN_KEYS = Object.keys(LINE_COLUMNS) as (keyof typeof LINE_COLUMNS)[];

/** Every `(org, proposal)` row of a planned write, as the table stores it. */
function inDraft<Row>(rows: Row[], orgId: string, proposalId: string) {
  return rows.map((row) => ({ ...row, orgId, proposalId }));
}

/**
 * Write what the plan (./draft-save-diff) decided, in an order every foreign key
 * and the child-draft trigger accept: new sections first (lines may move into
 * them), changed sections, new lines, changed lines (a moved line leaves its old
 * section here), then the removed lines, then the removed sections. An unchanged
 * row is not written at all, which is what keeps one edited line in a 2,000-line
 * draft to one row's WAL instead of a rewrite of the document.
 *
 * Every statement is scoped to this proposal as well as to the row id. A save
 * that sends NO sections deletes every stored row: it empties the document.
 */
export async function applyDraftWritePlan(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  plan: DraftWritePlan,
): Promise<void> {
  if (plan.sectionInserts.length) {
    await tx.insert(proposalSections).values(inDraft(plan.sectionInserts, orgId, proposalId));
  }
  const scope = { column: proposalSections.proposalId, value: proposalId };
  await updateRowsInChunks(tx, proposalSections, SECTION_COLUMN_KEYS, plan.sectionUpdates, scope);
  await insertLinesInChunks(tx, proposalLines, inDraft(plan.lineInserts, orgId, proposalId));
  await updateRowsInChunks(tx, proposalLines, LINE_COLUMN_KEYS, plan.lineUpdates, {
    column: proposalLines.proposalId,
    value: proposalId,
  });
  if (plan.lineDeletes.length) {
    await tx
      .delete(proposalLines)
      .where(and(eq(proposalLines.proposalId, proposalId), inArray(proposalLines.id, plan.lineDeletes)));
  }
  if (plan.sectionDeletes.length) {
    await tx
      .delete(proposalSections)
      .where(and(eq(proposalSections.proposalId, proposalId), inArray(proposalSections.id, plan.sectionDeletes)));
  }
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
