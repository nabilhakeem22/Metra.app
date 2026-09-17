import 'server-only';
import { boqLines, boqSections, boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { countCharacters } from '@/lib/validation/text';
import { bilingualFor } from '../bilingual';
import { MAX_BOQ_LINES, recomputeBoqTotals } from '../core';
import { MAX_DESCRIPTION } from '../edit-input';
import type { Tx } from './draft-guard';

/** The section, the document it belongs to, and the freeze check on that document. */
async function loadDraftSection(tx: Tx, sectionId: string) {
  const [section] = await tx
    .select({
      id: boqSections.id,
      boqId: boqSections.boqId,
      status: boqs.status,
      discountPct: boqs.discountPct,
    })
    .from(boqSections)
    .innerJoin(boqs, eq(boqs.id, boqSections.boqId))
    .where(eq(boqSections.id, sectionId))
    .limit(1);
  if (!section) fail('section_not_found');
  if (section.status !== 'draft') fail('boq_not_draft');
  return section;
}

/**
 * The same cap the importer enforces — a sheet can hold anything, and so can a
 * studio holding down the add button.
 */
async function refuseIfBoqIsFull(tx: Tx, boqId: string): Promise<void> {
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(boqLines)
    .where(eq(boqLines.boqId, boqId));
  if ((counted?.n ?? 0) >= MAX_BOQ_LINES) fail('too_many_lines');
}

async function nextLineSortOrder(tx: Tx, sectionId: string): Promise<number> {
  const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
    .select({ maxSort: sql<number>`coalesce(max(${boqLines.sortOrder}), -1)::int` })
    .from(boqLines)
    .where(eq(boqLines.sectionId, sectionId));
  return maxSort + 1;
}

/**
 * Append an empty line to a section.
 *
 * It arrives blank rather than as a copy of the line above: a duplicated row is
 * the classic way a wrong rate propagates down a BOQ, and the studio is about to
 * type over every column anyway. Description is seeded because the bilingual
 * CHECK will not hold a row with neither side present.
 */
export async function addBoqLineCore(
  ctx: OrgContext,
  input: { sectionId: string; description: string },
): Promise<ActionResult & { data?: string }> {
  const description = input.description.trim();
  // Two refusals, not one: a studio that TYPED a description, an over-long one,
  // must not be told the line needs one — the trap addBoqSectionCore fell into
  // with `section_name_required`.
  if (description === '') return err('description_required');
  if (countCharacters(description) > MAX_DESCRIPTION) {
    return err('description_too_long');
  }

  return mutateInOrg(ctx, { capability: 'boq_build', action: 'create' }, async (tx) => {
    const section = await loadDraftSection(tx, input.sectionId);
    await refuseIfBoqIsFull(tx, section.boqId);

    const [row] = await tx
      .insert(boqLines)
      .values({
        orgId: ctx.orgId,
        boqId: section.boqId,
        sectionId: section.id,
        ...bilingualFor(description),
        qty: '0',
        unit: 'pcs',
        unitPrice: '0',
        sortOrder: await nextLineSortOrder(tx, input.sectionId),
      })
      .returning({ id: boqLines.id });

    // A zero line moves no totals, but rolling up anyway keeps the invariant
    // "every write to a line re-rolls the document" true without exception.
    await recomputeBoqTotals(tx, section.boqId, section.discountPct);
    return row?.id;
  });
}
