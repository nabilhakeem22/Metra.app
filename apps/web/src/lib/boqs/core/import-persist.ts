// Stage 3 of the import: WRITE DOWN what the earlier stages decided. Nothing here
// validates or prices anything — `commit-import.ts` is the shape of the import,
// `import-pricing.ts` is the arithmetic, and this is the transaction.
//
// Split out for the same reason `proposals/core/draft-save-persist.ts` and
// `variations/core/update-persist.ts` exist, and because commit-import.ts was
// created at 153 lines — three over the Hard 150-line cap, which is the only kind
// of over-cap file the rulebook does not forgive. Splitting along the
// validate / price / persist seam is the division that was already there.
import { boqLines, boqSections, boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { ImportedLine } from '../import/map';
import { bilingualFor } from '../bilingual';
import { buildImportedLine, type PendingLine, type PriceBook } from './import-pricing';
import { recomputeBoqTotals } from './recompute';

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

/** Where the imported sections start, so an append does not collide with what is there. */
export async function highestSectionSortOrder(tx: Tx, boqId: string): Promise<number> {
  const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
    .select({ maxSort: sql<number>`coalesce(max(${boqSections.sortOrder}), -1)::int` })
    .from(boqSections)
    .where(eq(boqSections.boqId, boqId));
  return maxSort;
}

/** Insert one section per group, in first-seen order, and price its lines. */
export async function persistImportSections(
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
export async function finalizeImportedBoq(
  tx: Tx,
  input: { boqId: string; sourceFileId?: string | null },
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
