import 'server-only';
import { boqs } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { readMoneyString } from '@/lib/money/read';
import type { OrgContext } from '@/lib/db/context';
import { recomputeBoqTotals } from '../core';

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
