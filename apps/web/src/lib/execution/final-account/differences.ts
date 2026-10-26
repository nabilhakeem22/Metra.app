import 'server-only';
// The measured differences of a final account (الحساب الختامي): the contract
// lines whose FINAL measured quantity (the latest recorded reading, `seq
// desc`) differs from the contract quantity plus what approved change orders
// ordered on them. 50 at a time in document order, with how many there are of
// each kind: a provisional line bills its difference (D2a), a firm one is
// flagged as needing a change order. The per-line money is computeFinalAccount's
// (../money/final-account.ts) over the page; the account's own figure, the
// measured works, is summed in SQL by the same rule.
//
// The card reads the works, both counts and the first page in ONE statement,
// so the three figures cannot disagree (A5 reliability R2): the measured
// lines are `app_contract_measured_lines` and the works
// `app_contract_measured_works` (packages/db rls/functions/
// 65-execution-facts.sql, the client home's facts read the same two), each
// line's latest reading one index probe, so its database time follows the
// lines, not the readings (R3).
import type { MetraDb } from '@metra/db';
import { sql, type SQL } from 'drizzle-orm';

const DIFFERENCES_PAGE_SIZE = 50;

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

export interface DifferencesPage {
  rows: DifferenceRow[];
  nextCursor: string | null;
}

/** What the card needs of the measured lines, from one pass over them. */
export interface MeasuredDifferences {
  /** Σ works of the measured provisional lines, before the document discount. */
  measuredWorks: string;
  counts: { billed: number; flagged: number };
  firstPage: DifferencesPage;
}

type SqlRow = {
  line_id: string; section_title_ar: string | null; section_title_en: string | null; item_code: string | null;
  description_ar: string | null; description_en: string | null; unit: string; qty: string; unit_price: string;
  discount_pct: string; provisional: boolean; measured_qty: string; variation_qty: string;
};

/** The measured lines that differ, with their section's place and titles: the CTE `diff`. */
const differencesOf = (contractId: string) => sql`
  with diff as (
    select measured.*, s.sort_order as section_sort, s.title_ar as section_title_ar, s.title_en as section_title_en
      from public.app_contract_measured_lines(${contractId}) measured
      join public.contract_sections s on s.id = measured.section_id
     where measured.measured_qty - measured.qty - measured.variation_qty <> 0
  )`;

const DOCUMENT_ORDER = sql`section_sort, section_id, line_sort, line_id`;

/** A row as the page shows it; every figure as Postgres prints it (exact). */
const PAGE_ROW = sql`jsonb_build_object(
  'line_id', line_id, 'section_title_ar', section_title_ar, 'section_title_en', section_title_en,
  'item_code', item_code, 'description_ar', description_ar, 'description_en', description_en, 'unit', unit,
  'qty', qty::text, 'unit_price', unit_price::text, 'discount_pct', discount_pct::text, 'provisional', provisional,
  'measured_qty', measured_qty::text, 'variation_qty', variation_qty::text)`;

function rowOf(row: SqlRow): DifferenceRow {
  return {
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
  };
}

/** A page from up to PAGE_SIZE + 1 rows: the extra one only says more follow. */
function pageOf(rows: SqlRow[]): DifferencesPage {
  const page = rows.slice(0, DIFFERENCES_PAGE_SIZE).map(rowOf);
  return { rows: page, nextCursor: rows.length > DIFFERENCES_PAGE_SIZE ? page[page.length - 1].lineId : null };
}

/** The measured works, the counts of each kind and the first page, in one statement. */
export async function loadMeasuredDifferences(tx: MetraDb, contractId: string): Promise<MeasuredDifferences> {
  const rows = (await tx.execute(sql`${differencesOf(contractId)}, first_page as (
      select * from diff order by ${DOCUMENT_ORDER} limit ${DIFFERENCES_PAGE_SIZE + 1}
    )
    select public.app_contract_measured_works(${contractId}) as works,
           (select count(*) filter (where provisional)::int from diff) as billed,
           (select count(*) filter (where not provisional)::int from diff) as flagged,
           coalesce((select jsonb_agg(${PAGE_ROW} order by ${DOCUMENT_ORDER}) from first_page), '[]'::jsonb) as page
  `)) as unknown as Array<{ works: string; billed: number; flagged: number; page: SqlRow[] }>;
  const [row] = rows;
  return { measuredWorks: row.works, counts: { billed: row.billed, flagged: row.flagged }, firstPage: pageOf(row.page) };
}

/** Lines after the cursor line in document order; a line of another contract matches nothing. */
const pastCursor = (contractId: string, afterLineId: string): SQL => sql`where (${DOCUMENT_ORDER}) > (
  select cs.sort_order, cs.id, cl.sort_order, cl.id
    from public.contract_lines cl join public.contract_sections cs on cs.id = cl.section_id
   where cl.id = ${afterLineId} and cl.contract_id = ${contractId})`;

/**
 * One more page of differences after `afterLineId`. The cursor is a POSITION
 * in the document, so a page goes on from the right place even when a reading
 * since made the cursor line match its quantity.
 */
export async function listDifferencesAfter(tx: MetraDb, contractId: string, afterLineId: string): Promise<DifferencesPage> {
  const rows = (await tx.execute(sql`${differencesOf(contractId)}
    select line_id, section_title_ar, section_title_en, item_code, description_ar, description_en, unit,
           qty::text, unit_price::text, discount_pct::text, provisional, measured_qty::text, variation_qty::text
      from diff ${pastCursor(contractId, afterLineId)}
     order by ${DOCUMENT_ORDER}
     limit ${DIFFERENCES_PAGE_SIZE + 1}
  `)) as unknown as SqlRow[];
  return pageOf(rows);
}
