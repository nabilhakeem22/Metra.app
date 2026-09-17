import 'server-only';
// Changing one line of a draft BOQ.
//
// TOTALS ARE NEVER TRUSTED FROM THE CLIENT. Each write recomputes its own line
// with `computeLine` and then rolls the whole document up with
// `recomputeBoqTotals`, in the SAME transaction — so a section subtotal can never
// be stale with respect to the lines it sums, and a client that posts a flattering
// `lineTotal` is simply not consulted.
//
// `unitCost` is deliberately NOT editable from the sheet. Cost reaches a line from
// the price book at import, and the margin-blind roles never receive it in the
// first place (see ../queries.ts) — an editable cost column on a surface some
// roles can open would be a way to write a number you cannot read.
import { boqLines } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { withinMagnitude } from '@/lib/money/read';
import type { OrgContext } from '@/lib/db/context';
import { bilingualFor } from '../bilingual';
import { recomputeBoqTotals } from '../core';
import {
  normalizeLinePatch,
  type BoqLinePatch,
  type CleanLinePatch,
} from '../edit-input';
import { loadDraftForLine, type Tx } from './draft-guard';

export interface UpdateBoqLineInput {
  lineId: string;
  patch: BoqLinePatch;
}

/** The four money columns the arithmetic needs, as the row stands right now. */
type StoredLineMoney = {
  qty: string;
  unitPrice: string;
  unitCost: string;
  discountPct: string;
};

/**
 * Re-read the line INSIDE the transaction: the arithmetic needs whichever of
 * qty/price/cost the patch did not carry, and reading them here rather than
 * accepting them from the sheet is what stops a stale tab from reviving a figure
 * someone else already changed.
 */
function loadLineForEdit(tx: Tx, lineId: string): Promise<StoredLineMoney> {
  return requireInOrg(
    tx,
    boqLines,
    lineId,
    {
      qty: boqLines.qty,
      unitPrice: boqLines.unitPrice,
      unitCost: boqLines.unitCost,
      discountPct: boqLines.discountPct,
    },
    'line_not_found',
  );
}

/** The columns to write: the patch's own, plus the totals it implies. */
function applyLinePatch(
  patch: CleanLinePatch,
  current: StoredLineMoney,
): Partial<typeof boqLines.$inferInsert> {
  const qty = patch.qty ?? current.qty;
  const unitPrice = patch.unitPrice ?? current.unitPrice;
  const totals = computeLine({
    qty,
    unitPrice,
    unitCost: current.unitCost,
    discountPct: current.discountPct,
  });
  // The FACTORS are each inside the cap; their PRODUCT need not be. Same check
  // the import makes on every line it writes — the cost side included, because
  // unitCost is not editable here and the sheet never showed it.
  if (
    !withinMagnitude(totals.lineTotal) ||
    !withinMagnitude(totals.lineCost) ||
    !withinMagnitude(totals.lineMargin)
  ) {
    fail('amount_too_large');
  }
  return {
    ...(patch.itemCode !== undefined ? { itemCode: patch.itemCode } : {}),
    ...(patch.description !== undefined ? bilingualFor(patch.description) : {}),
    ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
    ...(patch.provisional !== undefined ? { provisional: patch.provisional } : {}),
    qty,
    unitPrice,
    ...totals,
  };
}

/**
 * Change one line and re-roll the document.
 *
 * The patch is SPARSE — the sheet saves the row a studio just left, not the whole
 * table — so an absent key leaves its column alone rather than writing a default
 * over it.
 */
export async function updateBoqLineCore(
  ctx: OrgContext,
  input: UpdateBoqLineInput,
): Promise<ActionResult> {
  const clean = normalizeLinePatch(input.patch);
  if (!clean.ok) return err(clean.error);

  return mutateInOrg(ctx, { capability: 'boq_build', action: 'update' }, async (tx) => {
    const { boqId, discountPct } = await loadDraftForLine(tx, input.lineId);
    const current = await loadLineForEdit(tx, input.lineId);

    await tx
      .update(boqLines)
      .set(applyLinePatch(clean.value, current))
      .where(eq(boqLines.id, input.lineId));

    await recomputeBoqTotals(tx, boqId, discountPct);
  });
}
