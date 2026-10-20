import 'server-only';
// The lines a site engineer measures, as the measurements tab reads them: 50
// at a time in document order (sections, then lines; ids break the ties), each
// with its FINAL MEASURED QUANTITY, the latest recorded reading (`seq desc`,
// read through the (org_id, contract_line_id, seq desc) index, one probe per
// line on the page), and what approved change orders ordered on it. Optionally
// only the provisional lines, and only lines matching every typed word.
// Nothing here grows with the contract: one page of lines, and the change
// orders' quantities summed per line in SQL.
//
// NO PRICE IS HERE: no unit price, total or cost leaves the database on this
// read, so the people on site see quantities only.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { everyWordSql } from '@/lib/search/words-sql';

export const MEASURABLE_LINES_PAGE_SIZE = 50;

export interface MeasurableLine {
  id: string;
  sectionTitleAr: string | null;
  sectionTitleEn: string | null;
  itemCode: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  unit: string;
  qty: string;
  /** Σ qty of approved change-order lines on this line (a de-scope is below zero). */
  variationQty: string;
  provisional: boolean;
  /** The latest recorded reading; null while the line is not measured. */
  latest: { measuredQty: string; measuredOn: string; note: string | null } | null;
}

export interface MeasurableLinesRequest {
  /** The last line of the previous page for the same filters; null for the first. */
  afterLineId: string | null;
  provisionalOnly: boolean;
  /** Every word must match the code, the description or the section title; empty matches all. */
  query: string;
}

export interface MeasurableLinesPage {
  lines: MeasurableLine[];
  /** The last line's id when more lines follow; null on the last page. */
  nextCursor: string | null;
}

type Row = {
  id: string; item_code: string | null; description_ar: string | null; description_en: string | null;
  unit: string; qty: string; provisional: boolean; section_title_ar: string | null; section_title_en: string | null;
  variation_qty: string; measured_qty: string | null; measured_on: string | null; note: string | null;
};

const LINE_TEXT = sql`concat_ws(' ', l.item_code, l.description_ar, l.description_en, s.title_ar, s.title_en)`;

/** Lines after the cursor line in document order; a cursor outside the contract matches nothing. */
const pastCursor = (contractId: string, afterLineId: string) => sql`(s.sort_order, s.id, l.sort_order, l.id) > (
  select cs.sort_order, cs.id, cl.sort_order, cl.id
    from public.contract_lines cl join public.contract_sections cs on cs.id = cl.section_id
   where cl.id = ${afterLineId} and cl.contract_id = ${contractId})`;

function lineOf(row: Row): MeasurableLine {
  return {
    id: row.id,
    sectionTitleAr: row.section_title_ar,
    sectionTitleEn: row.section_title_en,
    itemCode: row.item_code,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    unit: row.unit,
    qty: row.qty,
    variationQty: row.variation_qty,
    provisional: row.provisional,
    latest:
      row.measured_qty === null || row.measured_on === null
        ? null
        : { measuredQty: row.measured_qty, measuredOn: row.measured_on, note: row.note },
  };
}

/** One page of the contract's lines, inside the caller's org transaction (RLS scopes every table). */
export async function listMeasurableLines(
  tx: MetraDb,
  contractId: string,
  request: MeasurableLinesRequest,
): Promise<MeasurableLinesPage> {
  const filters = [
    request.provisionalOnly ? sql`l.provisional` : undefined,
    everyWordSql(LINE_TEXT, request.query),
    request.afterLineId ? pastCursor(contractId, request.afterLineId) : undefined,
  ].filter((filter) => filter !== undefined);
  const rows = (await tx.execute(sql`
    with ordered as (
      select vl.contract_line_id, sum(vl.qty) as qty
        from public.variation_order_lines vl
        join public.variation_orders v on v.id = vl.variation_order_id and v.org_id = vl.org_id
       where v.contract_id = ${contractId} and v.status = 'approved' and vl.contract_line_id is not null
       group by vl.contract_line_id
    )
    select l.id, l.item_code, l.description_ar, l.description_en, l.unit::text as unit, l.qty::text as qty, l.provisional,
           s.title_ar as section_title_ar, s.title_en as section_title_en,
           coalesce(ordered.qty, 0)::text as variation_qty,
           latest.measured_qty::text as measured_qty, to_char(latest.measured_on, 'YYYY-MM-DD') as measured_on, latest.note
      from public.contract_lines l
      join public.contract_sections s on s.id = l.section_id
      left join ordered on ordered.contract_line_id = l.id
      left join lateral (
        select m.measured_qty, m.measured_on, m.note from public.contract_line_measurements m
         where m.org_id = l.org_id and m.contract_line_id = l.id
         order by m.seq desc limit 1
      ) latest on true
     where l.contract_id = ${contractId}
       ${filters.length > 0 ? sql`and ${sql.join(filters, sql` and `)}` : sql``}
     order by s.sort_order, s.id, l.sort_order, l.id
     limit ${MEASURABLE_LINES_PAGE_SIZE + 1}
  `)) as unknown as Row[];
  const page = rows.slice(0, MEASURABLE_LINES_PAGE_SIZE).map(lineOf);
  return { lines: page, nextCursor: rows.length > MEASURABLE_LINES_PAGE_SIZE ? page[page.length - 1].id : null };
}
