import 'server-only';
import { boqLines, boqSections, boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { readMoneyString } from '@/lib/money/read';
import { withinMagnitude } from '@/lib/money/read';
import type { OrgContext } from '@/lib/db/context';
import { countCharacters } from '@/lib/validation/text';
import { bilingualFor } from '../bilingual';
import { MAX_BOQ_LINES, recomputeBoqTotals } from '../core';
import {
  MAX_DESCRIPTION,
  normalizeLinePatch,
  type BoqLinePatch,
} from '../edit-input';

/**
 * Editing a draft BOQ line by line.
 *
 * THE FREEZE RULE IS ENFORCED HERE, not in the sheet. Every core below reloads
 * the parent BOQ and refuses anything that is not `draft`. Hiding the inputs on
 * an issued document is a courtesy to the studio; this is the part that actually
 * holds, because once issued the PDF in the client's hands and the rows in this
 * table must never drift apart (see issue.ts).
 *
 * TOTALS ARE NEVER TRUSTED FROM THE CLIENT. Each write recomputes its own line
 * with `computeLine` and then rolls the whole document up with
 * `recomputeBoqTotals`, in the SAME transaction — so a section subtotal can
 * never be stale with respect to the lines it sums, and a client that posts a
 * flattering `lineTotal` is simply not consulted.
 *
 * `unitCost` is deliberately NOT editable from the sheet. Cost reaches a line
 * from the price book at import, and the margin-blind roles never receive it in
 * the first place (see queries.ts) — an editable cost column on a surface some
 * roles can open would be a way to write a number you cannot read.
 */

/** Look up a line's BOQ and refuse unless that document is still a draft. */
async function loadDraftForLine(
  tx: Tx,
  lineId: string,
): Promise<{ boqId: string; sectionId: string; discountPct: string }> {
  const [row] = await tx
    .select({
      boqId: boqLines.boqId,
      sectionId: boqLines.sectionId,
      status: boqs.status,
      discountPct: boqs.discountPct,
    })
    .from(boqLines)
    .innerJoin(boqs, eq(boqs.id, boqLines.boqId))
    .where(eq(boqLines.id, lineId))
    .limit(1);
  if (!row) fail('line_not_found');
  if (row.status !== 'draft') fail('boq_not_draft');
  return {
    boqId: row.boqId,
    sectionId: row.sectionId,
    discountPct: row.discountPct,
  };
}

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

export interface UpdateBoqLineInput {
  lineId: string;
  patch: BoqLinePatch;
}

/**
 * Change one line and re-roll the document.
 *
 * The patch is SPARSE — the sheet saves the row a studio just left, not the
 * whole table — so an absent key leaves its column alone rather than writing a
 * default over it.
 */
export async function updateBoqLineCore(
  ctx: OrgContext,
  input: UpdateBoqLineInput,
): Promise<ActionResult> {
  const clean = normalizeLinePatch(input.patch);
  if (!clean.ok) return err(clean.error);

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      const { boqId, discountPct } = await loadDraftForLine(tx, input.lineId);

      // Re-read the line INSIDE the transaction: the arithmetic needs whichever
      // of qty/price/cost the patch did not carry, and reading them here rather
      // than accepting them from the sheet is what stops a stale tab from
      // reviving a figure someone else already changed.
      const current = await requireInOrg(
        tx,
        boqLines,
        input.lineId,
        {
          qty: boqLines.qty,
          unitPrice: boqLines.unitPrice,
          unitCost: boqLines.unitCost,
          discountPct: boqLines.discountPct,
        },
        'line_not_found',
      );

      const qty = clean.value.qty ?? current.qty;
      const unitPrice = clean.value.unitPrice ?? current.unitPrice;
      const totals = computeLine({
        qty,
        unitPrice,
        unitCost: current.unitCost,
        discountPct: current.discountPct,
      });
      // The FACTORS are each inside the cap; their PRODUCT need not be. Same
      // check the import makes on every line it writes — the cost side included,
      // because unitCost is not editable here and the sheet never showed it.
      if (
        !withinMagnitude(totals.lineTotal) ||
        !withinMagnitude(totals.lineCost) ||
        !withinMagnitude(totals.lineMargin)
      ) {
        fail('amount_too_large');
      }

      await tx
        .update(boqLines)
        .set({
          ...(clean.value.itemCode !== undefined
            ? { itemCode: clean.value.itemCode }
            : {}),
          ...(clean.value.description !== undefined
            ? bilingualFor(clean.value.description)
            : {}),
          ...(clean.value.unit !== undefined ? { unit: clean.value.unit } : {}),
          ...(clean.value.provisional !== undefined
            ? { provisional: clean.value.provisional }
            : {}),
          qty,
          unitPrice,
          ...totals,
        })
        .where(eq(boqLines.id, input.lineId));

      await recomputeBoqTotals(tx, boqId, discountPct);
    },
  );
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
  // Two refusals, not one: a studio that TYPED a description, an over-long
  // one, must not be told the line needs one — the trap addBoqSectionCore
  // fell into with `section_name_required`.
  if (description === '') return err('description_required');
  if (countCharacters(description) > MAX_DESCRIPTION) {
    return err('description_too_long');
  }

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'create' },
    async (tx) => {
      const [section] = await tx
        .select({
          id: boqSections.id,
          boqId: boqSections.boqId,
          status: boqs.status,
          discountPct: boqs.discountPct,
        })
        .from(boqSections)
        .innerJoin(boqs, eq(boqs.id, boqSections.boqId))
        .where(eq(boqSections.id, input.sectionId))
        .limit(1);
      if (!section) fail('section_not_found');
      if (section.status !== 'draft') fail('boq_not_draft');

      // The same cap the importer enforces — a sheet can hold anything, and so
      // can a studio holding down the add button.
      const [counted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(boqLines)
        .where(eq(boqLines.boqId, section.boqId));
      if ((counted?.n ?? 0) >= MAX_BOQ_LINES) fail('too_many_lines');

      const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
        .select({
          maxSort: sql<number>`coalesce(max(${boqLines.sortOrder}), -1)::int`,
        })
        .from(boqLines)
        .where(eq(boqLines.sectionId, input.sectionId));

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
          sortOrder: maxSort + 1,
        })
        .returning({ id: boqLines.id });

      // A zero line moves no totals, but rolling up anyway keeps the invariant
      // "every write to a line re-rolls the document" true without exception.
      await recomputeBoqTotals(tx, section.boqId, section.discountPct);
      return row?.id;
    },
  );
}

/** Remove a line and re-roll. Deleting from a draft is not a soft delete: the
 *  document has not been issued, so there is no history to protect yet. */
export async function deleteBoqLineCore(
  ctx: OrgContext,
  input: { lineId: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      const { boqId, discountPct } = await loadDraftForLine(tx, input.lineId);
      await tx.delete(boqLines).where(eq(boqLines.id, input.lineId));
      await recomputeBoqTotals(tx, boqId, discountPct);
    },
  );
}

/**
 * Add a section to a draft BOQ.
 *
 * Without this a BOQ created from scratch has nowhere to put a line — sections
 * only ever arrived from the importer, which left "build it by hand" as a path
 * that dead-ends on an empty document.
 */
export async function addBoqSectionCore(
  ctx: OrgContext,
  input: { boqId: string; title: string },
): Promise<ActionResult & { data?: string }> {
  const title = input.title.trim();
  // `name_required` used to serve this, the org bilingual check AND the BOQ
  // title, so the studio adding a nameless section was told to "enter at least
  // one company name". One string cannot answer for three different things —
  // and neither can `section_name_required`, which was left answering for two:
  // a studio that TYPED a name, an over-long one, was told the section needs one.
  if (title === '') return err('section_name_required');
  if (countCharacters(title) > MAX_DESCRIPTION) return err('section_name_too_long');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'create' },
    async (tx) => {
      const boq = await requireInOrg(
        tx,
        boqs,
        input.boqId,
        { id: boqs.id, status: boqs.status },
        'boq_not_found',
      );
      if (boq.status !== 'draft') fail('boq_not_draft');

      const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
        .select({
          maxSort: sql<number>`coalesce(max(${boqSections.sortOrder}), -1)::int`,
        })
        .from(boqSections)
        .where(eq(boqSections.boqId, input.boqId));

      const bilingual = bilingualFor(title);
      const [row] = await tx
        .insert(boqSections)
        .values({
          orgId: ctx.orgId,
          boqId: input.boqId,
          titleAr: bilingual.descriptionAr,
          titleEn: bilingual.descriptionEn,
          sortOrder: maxSort + 1,
        })
        .returning({ id: boqSections.id });
      return row?.id;
    },
  );
}

/**
 * Set the document-level discount.
 *
 * It lives here rather than on a line because that is where the schema puts it:
 * `boqs.discount_pct` comes off the subtotal, and `computeBoqTotals` measures
 * margin against the DISCOUNTED total — a discount comes out of margin, never
 * out of cost.
 */
export async function setBoqDiscountCore(
  ctx: OrgContext,
  input: { boqId: string; discountPct: string },
): Promise<ActionResult> {
  // Typed by the studio, so the same rule as every other sheet field: a
  // separator is fine, anything else is a refusal rather than a zero.
  const pct = readMoneyString(input.discountPct, { allowGroupSeparators: true });
  // 0..100 is the schema's own range (boq_lines_discount_pct_range's sibling on
  // boqs); refusing here means the CHECK is a backstop rather than the error path.
  if (pct === null || Number(pct) > 100) return err('invalid_discount');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      const boq = await requireInOrg(
        tx,
        boqs,
        input.boqId,
        { id: boqs.id, status: boqs.status },
        'boq_not_found',
      );
      if (boq.status !== 'draft') fail('boq_not_draft');

      await tx
        .update(boqs)
        .set({ discountPct: pct })
        .where(eq(boqs.id, input.boqId));
      await recomputeBoqTotals(tx, input.boqId, pct);
    },
  );
}
