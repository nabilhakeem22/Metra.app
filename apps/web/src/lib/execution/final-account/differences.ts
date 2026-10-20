import 'server-only';
// The measured differences of a final account (الحساب الختامي): the contract
// lines whose FINAL measured quantity (the latest recorded reading, `seq
// desc`) differs from the contract quantity plus what approved change orders
// ordered on them. 50 at a time in document order, with how many there are of
// each kind: a provisional line bills its difference (D2a), a firm one is
// flagged as needing a change order. The per-line money is computeFinalAccount's
// (../money/final-account.ts) over the page; the account's own figures come
// from the SQL sum (../queries/measured-works.ts), so nothing here grows with
// the number of lines measured.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

export const DIFFERENCES_PAGE_SIZE = 50;

export interface DifferenceRow {
  lineId: string;
  sectionTitleAr: string | null;
  sectionTitleEn: string | null;
  itemCode: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  unit: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  provisional: boolean;
  measuredQty: string;
  variationQty: string;
}

type SqlRow = {
  line_id: string; section_title_ar: string | null; section_title_en: string | null; item_code: string | null;
  description_ar: string | null; description_en: string | null; unit: string; qty: string; unit_price: string;
  discount_pct: string; provisional: boolean; measured_qty: string; variation_qty: string;
};

/** Every measured line with its latest reading and its ordered quantity; the differences only. */
const differencesOf = (contractId: string) => sql`
  with latest as (
    select distinct on (m.contract_line_id) m.contract_line_id, m.measured_qty
      from public.contract_line_measurements m
     where m.contract_id = ${contractId}
     order by m.contract_line_id, m.seq desc
  ), ordered as (
    select vl.contract_line_id, sum(vl.qty) as qty
      from public.variation_order_lines vl
      join public.variation_orders v on v.id = vl.variation_order_id and v.org_id = vl.org_id
     where v.contract_id = ${contractId} and v.status = 'approved' and vl.contract_line_id is not null
     group by vl.contract_line_id
  ), diff as (
    select l.id as line_id, s.sort_order as section_sort, s.id as section_id, l.sort_order as line_sort,
           s.title_ar as section_title_ar, s.title_en as section_title_en, l.item_code, l.description_ar,
           l.description_en, l.unit::text as unit, l.qty, l.unit_price, l.discount_pct, l.provisional,
           latest.measured_qty, coalesce(ordered.qty, 0) as variation_qty
      from latest
      join public.contract_lines l on l.id = latest.contract_line_id and l.contract_id = ${contractId}
      join public.contract_sections s on s.id = l.section_id
      left join ordered on ordered.contract_line_id = l.id
     where latest.measured_qty - l.qty - coalesce(ordered.qty, 0) <> 0
  )`;

export async function countDifferences(tx: MetraDb, contractId: string): Promise<{ billed: number; flagged: number }> {
  const rows = (await tx.execute(sql`${differencesOf(contractId)}
    select count(*) filter (where provisional)::int as billed, count(*) filter (where not provisional)::int as flagged from diff
  `)) as unknown as Array<{ billed: number; flagged: number }>;
  return rows[0];
}

/**
 * One page of differences after `afterLineId` (the first for null). The cursor
 * is a POSITION in the document, so a page goes on from the right place even
 * when a reading since made the cursor line match its quantity; a line of
 * another contract matches nothing.
 */
export async function listDifferences(
  tx: MetraDb,
  contractId: string,
  afterLineId: string | null,
): Promise<{ rows: DifferenceRow[]; nextCursor: string | null }> {
  const cursor = afterLineId
    ? sql`where (section_sort, section_id, line_sort, line_id) > (
            select cs.sort_order, cs.id, cl.sort_order, cl.id
              from public.contract_lines cl join public.contract_sections cs on cs.id = cl.section_id
             where cl.id = ${afterLineId} and cl.contract_id = ${contractId})`
    : sql``;
  const rows = (await tx.execute(sql`${differencesOf(contractId)}
    select line_id, section_title_ar, section_title_en, item_code, description_ar, description_en, unit,
           qty::text, unit_price::text, discount_pct::text, provisional, measured_qty::text, variation_qty::text
      from diff ${cursor}
     order by section_sort, section_id, line_sort, line_id
     limit ${DIFFERENCES_PAGE_SIZE + 1}
  `)) as unknown as SqlRow[];
  const page = rows.slice(0, DIFFERENCES_PAGE_SIZE).map((row) => ({
    lineId: row.line_id,
    sectionTitleAr: row.section_title_ar,
    sectionTitleEn: row.section_title_en,
    itemCode: row.item_code,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    unit: row.unit,
    qty: row.qty,
    unitPrice: row.unit_price,
    discountPct: row.discount_pct,
    provisional: row.provisional,
    measuredQty: row.measured_qty,
    variationQty: row.variation_qty,
  }));
  return { rows: page, nextCursor: rows.length > DIFFERENCES_PAGE_SIZE ? page[page.length - 1].lineId : null };
}
