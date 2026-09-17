// Writing an imported sheet into a draft BOQ. PURE core — no next/*, no cookies.
import { boqLines, boqSections, boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { ImportedLine } from '../import/map';
import { bilingualFor } from '../bilingual';
import { MAX_BOQ_LINES } from './create';
import {
  buildImportedLine,
  resolvePriceBook,
  type PendingLine,
  type PriceBook,
} from './import-pricing';
import { recomputeBoqTotals } from './recompute';

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

/** Group imported lines by their section label, preserving first-seen order. */
function groupBySection(lines: ImportedLine[]): Map<string, ImportedLine[]> {
  const groups = new Map<string, ImportedLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.section);
    if (existing) existing.push(line);
    else groups.set(line.section, [line]);
  }
  return groups;
}

export interface CommitImportInput {
  boqId: string;
  lines: ImportedLine[];
  /** The uploaded sheet, kept for provenance. */
  sourceFileId?: string | null;
  /** Replace everything already in the BOQ rather than appending. */
  replace?: boolean;
}

/** The two answers available BEFORE the transaction opens, or null to proceed. */
function validateImportedLines(lines: ImportedLine[]): ActionResult | null {
  if (lines.length === 0) return err('invalid');
  if (lines.length > MAX_BOQ_LINES) return err('too_many_lines');
  return null;
}

/** Where the imported sections start, so an append does not collide with what is there. */
async function highestSectionSortOrder(tx: Tx, boqId: string): Promise<number> {
  const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
    .select({ maxSort: sql<number>`coalesce(max(${boqSections.sortOrder}), -1)::int` })
    .from(boqSections)
    .where(eq(boqSections.boqId, boqId));
  return maxSort;
}

/** Insert one section per group, in first-seen order, and price its lines. */
async function persistImportSections(
  tx: Tx,
  context: { orgId: string; boqId: string; priceBook: PriceBook; startSortOrder: number },
  groups: Map<string, ImportedLine[]>,
): Promise<PendingLine[]> {
  let sortOrder = context.startSortOrder;
  const pendingLines: PendingLine[] = [];
  for (const [title, groupLines] of groups) {
    sortOrder += 1;
    const [section] = await tx
      .insert(boqSections)
      .values({
        orgId: context.orgId,
        boqId: context.boqId,
        titleAr: bilingualFor(title).descriptionAr,
        titleEn: bilingualFor(title).descriptionEn,
        sortOrder,
      })
      .returning({ id: boqSections.id });
    if (!section) fail('invalid');

    groupLines.forEach((line, i) => {
      pendingLines.push(buildImportedLine({ ...context, sectionId: section.id }, line, i));
    });
  }
  return pendingLines;
}

/** The lines, the totals and the provenance — in that order, in this transaction. */
async function finalizeImportedBoq(
  tx: Tx,
  input: CommitImportInput,
  discountPct: string,
  pendingLines: PendingLine[],
): Promise<void> {
  // Batched: one insert per import, not one per line — and chunked, because a
  // full 2000-line sheet is ~34,000 bind parameters, over half of what a single
  // statement can carry before it fails outright.
  await insertLinesInChunks(tx, boqLines, pendingLines);

  await recomputeBoqTotals(tx, input.boqId, discountPct);

  if (input.sourceFileId) {
    await tx
      .update(boqs)
      .set({ source: 'imported', sourceFileId: input.sourceFileId })
      .where(eq(boqs.id, input.boqId));
  } else {
    await tx.update(boqs).set({ source: 'imported' }).where(eq(boqs.id, input.boqId));
  }
}

/**
 * Write imported lines into a draft BOQ, creating sections as needed and
 * recomputing every total in the same transaction.
 *
 * Totals are SERVER-WRITTEN from the line values, never trusted from the client:
 * the preview computes the same figures with the same functions, so if the two
 * ever disagreed the persisted document would still be the correct one.
 */
export async function commitImportCore(
  ctx: OrgContext,
  input: CommitImportInput,
): Promise<ActionResult & { data?: number }> {
  const refusal = validateImportedLines(input.lines);
  if (refusal) return refusal;

  return mutateInOrg(ctx, { capability: 'boq_build', action: 'update' }, async (tx) => {
    const boq = await requireInOrg(
      tx,
      boqs,
      input.boqId,
      { id: boqs.id, status: boqs.status, discountPct: boqs.discountPct },
      'boq_not_found',
    );
    // An issued BOQ is frozen; a revision supersedes it rather than editing it.
    if (boq.status !== 'draft') fail('boq_not_draft');

    if (input.replace) {
      // Lines cascade from sections, so removing sections is enough.
      await tx.delete(boqSections).where(eq(boqSections.boqId, input.boqId));
    }

    const startSortOrder = await highestSectionSortOrder(tx, input.boqId);
    const priceBook = await resolvePriceBook(tx, input.lines);
    const pendingLines = await persistImportSections(
      tx,
      { orgId: ctx.orgId, boqId: input.boqId, priceBook, startSortOrder },
      groupBySection(input.lines),
    );

    await finalizeImportedBoq(tx, input, boq.discountPct, pendingLines);

    return pendingLines.length;
  });
}
