import 'server-only';
// The cost sheet (كشف التكلفة) of one execution contract, read in ONE SQL
// statement of aggregates (plan A17, A25): per section the budget (Σ
// line_cost), the change-order budget on its lines and the actual cost (Σ live
// cost entries), plus the new-scope change-order budget, the cost booked to no
// section, the approved change orders' net deltas and what was requested and
// paid. No line, entry or request row crosses the wire. Sections past
// COST_SHEET_SECTIONS_CAP are folded into one row in SQL, with their
// projected cost summed by the same per-section rule buildCostSheet applies
// (greatest of budget and actual, per section). buildCostSheet does the money.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { buildCostSheet } from '../money/cost-sheet';
import { COST_SHEET_SECTIONS_CAP, type CostSheet, type CostSheetSectionInput, type FoldedSectionsInput } from '../money/cost-sheet-types';
import { loadExecutionContract } from '../queries/execution-contract';

type Row = {
  sections: Array<{ id: string; title_ar: string | null; title_en: string | null; budget: string; vo_budget: string; actual: string }>;
  folded: { count: number; budget: string; actual: string; projected: string } | null;
  new_scope: string;
  unallocated: string;
  approved_deltas: string[];
  requested: string;
  paid: string;
};

async function loadCostAggregates(tx: MetraDb, contractId: string): Promise<Row> {
  const rows = (await tx.execute(sql`
    with vo_lines as (
      select vl.contract_line_id, vl.line_cost
        from public.variation_order_lines vl
        join public.variation_orders v on v.id = vl.variation_order_id and v.org_id = vl.org_id
       where v.contract_id = ${contractId} and v.status = 'approved'
    ), live_costs as (
      select e.contract_section_id, e.amount from public.contract_cost_entries e
       where e.contract_id = ${contractId} and e.voided_at is null
    ), per_section as (
      select s.id, s.title_ar, s.title_en,
             coalesce(b.budget, 0) as budget, coalesce(o.vo_budget, 0) as vo_budget, coalesce(a.actual, 0) as actual,
             row_number() over (order by s.sort_order, s.id) as position
        from public.contract_sections s
        left join (select l.section_id, sum(l.line_cost) as budget from public.contract_lines l
                    where l.contract_id = ${contractId} group by l.section_id) b on b.section_id = s.id
        left join (select l.section_id, sum(vo.line_cost) as vo_budget from vo_lines vo
                     join public.contract_lines l on l.id = vo.contract_line_id and l.contract_id = ${contractId}
                    group by l.section_id) o on o.section_id = s.id
        left join (select c.contract_section_id, sum(c.amount) as actual from live_costs c
                    where c.contract_section_id is not null group by c.contract_section_id) a on a.contract_section_id = s.id
       where s.contract_id = ${contractId}
    )
    select
      coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title_ar', p.title_ar, 'title_en', p.title_en,
                  'budget', p.budget::text, 'vo_budget', p.vo_budget::text, 'actual', p.actual::text) order by p.position)
                  from per_section p where p.position <= ${COST_SHEET_SECTIONS_CAP}), '[]'::jsonb) as sections,
      (select jsonb_build_object('count', count(*), 'budget', sum(p.budget + p.vo_budget)::text, 'actual', sum(p.actual)::text,
                'projected', sum(greatest(p.budget + p.vo_budget, p.actual))::text)
         from per_section p where p.position > ${COST_SHEET_SECTIONS_CAP} having count(*) > 0) as folded,
      coalesce((select sum(vo.line_cost) from vo_lines vo where vo.contract_line_id is null), 0)::text as new_scope,
      coalesce((select sum(c.amount) from live_costs c where c.contract_section_id is null), 0)::text as unallocated,
      coalesce((select jsonb_agg(v.net_delta::text) from public.variation_orders v
                 where v.contract_id = ${contractId} and v.status = 'approved'), '[]'::jsonb) as approved_deltas,
      coalesce((select sum(r.amount) from public.payment_requests r
                 where r.contract_id = ${contractId} and r.status = 'issued'), 0)::text as requested,
      coalesce((select sum(p.amount) from public.contract_payments p where p.contract_id = ${contractId}), 0)::text as paid
  `)) as unknown as Row[];
  return rows[0];
}

const sectionOf = (row: Row['sections'][number]): CostSheetSectionInput => ({
  sectionId: row.id,
  titleAr: row.title_ar,
  titleEn: row.title_en,
  budgetCost: row.budget,
  variationBudgetCost: row.vo_budget,
  actualCost: row.actual,
});

const foldedOf = (folded: Row['folded']): FoldedSectionsInput | null =>
  folded && { count: Number(folded.count), budgetCost: folded.budget, actualCost: folded.actual, projectedCost: folded.projected };

/** The contract's cost sheet, cost and margin left out unless `canSeeMargin`; null when it is not the caller's execution contract. */
export function getCostSheet(ctx: OrgContext, contractId: string, canSeeMargin: boolean): Promise<CostSheet | null> {
  return withOrgContext(ctx, async (tx) => {
    const contract = await loadExecutionContract(tx, contractId);
    if (!contract) return null;
    const row = await loadCostAggregates(tx, contractId);
    return buildCostSheet(
      {
        originalValue: contract.originalValue,
        taxAmount: contract.taxAmount,
        taxRate: contract.taxRate,
        supervisionPct: contract.supervisionPct,
        approvedVariationNetDeltas: row.approved_deltas,
        sections: row.sections.map(sectionOf),
        moreSections: foldedOf(row.folded),
        newScopeVariationsCost: row.new_scope,
        unallocatedActualCost: row.unallocated,
        requestedTotal: row.requested,
        paidTotal: row.paid,
      },
      canSeeMargin,
    );
  });
}
