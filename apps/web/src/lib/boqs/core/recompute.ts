// Re-summing a BOQ from its lines. PURE core — no next/*, no cookies.
import { boqs } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { SectionTotals } from '@/lib/aggregates/proposal-totals';
import { withinMagnitude } from '@/lib/money/read';
import { computeBoqTotals } from '../totals';

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

/**
 * Re-sum every section of the BOQ from its lines and write the subtotals back,
 * in ONE statement — this used to be two queries per section.
 *
 * LEFT JOIN so a section whose lines have all been deleted is zeroed rather than
 * left carrying a stale subtotal. The database sums numeric(18,4), which is
 * exact addition — the same arithmetic `computeSection` does in BigInt piastres,
 * and a dbtest asserts the two agree.
 */
async function sectionAggregates(
  tx: Tx,
  boqId: string,
): Promise<SectionTotals[]> {
  return (await tx.execute(sql`
    update public.boq_sections s
    set section_subtotal = agg.section_subtotal
    from (
      select sec.id as section_id,
             coalesce(sum(l.line_total), 0)::numeric(18,4) as section_subtotal,
             coalesce(sum(l.line_cost), 0)::numeric(18,4) as section_cost,
             coalesce(sum(l.line_margin), 0)::numeric(18,4) as section_margin
      from public.boq_sections sec
      left join public.boq_lines l
        on l.section_id = sec.id and l.boq_id = ${boqId}
      where sec.boq_id = ${boqId}
      group by sec.id
    ) agg
    where s.id = agg.section_id
    returning agg.section_subtotal as "sectionSubtotal",
              agg.section_cost as "sectionCost",
              agg.section_margin as "sectionMargin"
  `)) as unknown as SectionTotals[];
}

/**
 * Recompute every section subtotal and the document total from the lines as they
 * now stand. Called inside the same transaction as any line change, so a total
 * can never be stale with respect to the lines it sums.
 */
export async function recomputeBoqTotals(
  tx: Tx,
  boqId: string,
  discountPct: string,
): Promise<void> {
  const doc = computeBoqTotals(await sectionAggregates(tx, boqId), {
    discountPct,
  });
  // Every line was capped on the way in, but a document is the SUM of them: 2000
  // capped lines can still roll up past what numeric(18,4) holds, and the roll-up
  // is the last place to say so with a coded error instead of a raw 22003.
  if (
    !withinMagnitude(doc.total) ||
    !withinMagnitude(doc.totalCost) ||
    !withinMagnitude(doc.totalMargin)
  ) {
    fail('amount_too_large');
  }
  await tx
    .update(boqs)
    .set({
      subtotal: doc.subtotal,
      discountAmount: doc.discountAmount,
      total: doc.total,
      totalCost: doc.totalCost,
      totalMargin: doc.totalMargin,
    })
    .where(eq(boqs.id, boqId));
}
