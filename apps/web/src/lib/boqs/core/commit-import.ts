// Writing an imported sheet into a draft BOQ. PURE core — no next/*, no cookies.
//
// THE SHAPE of the import lives here; the arithmetic is `import-pricing.ts` and
// the writes are `import-persist.ts`. That seam was already described in
// import-pricing.ts's own header when this file was created; it is split along it
// now because the file was born at 153 lines, three over the Hard 150-line cap.
import { boqSections, boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { ImportedLine } from '../import/map';
import { MAX_BOQ_LINES } from './create';
import {
  finalizeImportedBoq,
  highestSectionSortOrder,
  persistImportSections,
} from './import-persist';
import { resolvePriceBook } from './import-pricing';

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
