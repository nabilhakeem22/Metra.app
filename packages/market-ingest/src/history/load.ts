// The published history the DB-backed checks compare a bulletin against (B6,
// B7, B11, F1, F2, F3). Read-only, as the connection role: what is PUBLISHED,
// never what a studio's RLS view happens to show.
import type { EffectivePoint, PublishedHistory, PublishedItem } from '../check/context';
import type { Queryable } from '../db/connection';
import { canonicalDecimal } from '../normalize';
import type { RollPack } from '../roll-pack';
import type { MarketUnit } from '../units';

interface ItemRow {
  key: string;
  name_ar: string;
  name_en: string;
  spec_ar: string | null;
  spec_en: string | null;
  unit_label_ar: string;
  basis_note_ar: string | null;
  unit: MarketUnit;
  status: 'active' | 'discontinued';
  source_labels: string[];
  pack_length_m: string | null;
  pack_pieces: number | null;
  pack_piece_length_m: string | null;
  has_history: boolean;
}

export function packOf(row: Pick<ItemRow, 'pack_length_m' | 'pack_pieces' | 'pack_piece_length_m'>): RollPack | null {
  if (row.pack_length_m === null && row.pack_pieces === null) return null;
  return {
    lengthM: row.pack_length_m === null ? null : Number(row.pack_length_m),
    pieces: row.pack_pieces,
    pieceLengthM: row.pack_piece_length_m === null ? null : Number(row.pack_piece_length_m),
  };
}

/** `period` is the bulletin being checked ('YYYY-MM'); effective prices come from EARLIER bulletins only. */
export async function loadHistory(sql: Queryable, period: string): Promise<PublishedHistory> {
  const itemRows = await sql<ItemRow[]>`
    select i.key, i.unit, i.status, i.source_labels, i.pack_length_m, i.pack_pieces, i.pack_piece_length_m,
           i.name_ar, i.name_en, i.spec_ar, i.spec_en, i.unit_label_ar, i.basis_note_ar,
           exists (select 1 from market_price_observations o join market_bulletins b on b.id = o.bulletin_id
                    where o.item_id = i.id and b.status = 'published') as has_history
      from market_items i`;
  const items = new Map<string, PublishedItem>(
    itemRows.map((row) => [
      row.key,
      {
        key: row.key,
        unit: row.unit,
        pack: packOf(row),
        status: row.status,
        sourceLabels: row.source_labels,
        details: { nameAr: row.name_ar, nameEn: row.name_en, specAr: row.spec_ar, specEn: row.spec_en, unitLabelAr: row.unit_label_ar, basisNoteAr: row.basis_note_ar },
        hasHistory: row.has_history,
      },
    ]),
  );
  const pointRows = await sql<Array<{ key: string; month: string; status: EffectivePoint['status']; price: string | null; bulletin_period: string }>>`
    select distinct on (o.item_id, o.period_month)
           i.key, to_char(o.period_month, 'YYYY-MM') as month, o.status, o.price::text as price,
           to_char(b.period_month, 'YYYY-MM') as bulletin_period
      from market_price_observations o
      join market_bulletins b on b.id = o.bulletin_id and b.status = 'published'
      join market_items i on i.id = o.item_id
     where b.period_month < ${`${period}-01`}::date
     order by o.item_id, o.period_month, b.period_month desc`;
  const effective = new Map<string, Map<string, EffectivePoint>>();
  for (const row of pointRows) {
    const series = effective.get(row.key) ?? new Map<string, EffectivePoint>();
    series.set(row.month, { status: row.status, price: row.price === null ? null : canonicalDecimal(row.price), bulletinPeriod: row.bulletin_period });
    effective.set(row.key, series);
  }
  const bulletins = await sql<Array<{ period: string; pdf_sha256: string | null; md_sha256: string | null }>>`
    select to_char(period_month, 'YYYY-MM') as period, source_pdf_sha256 as pdf_sha256, source_md_sha256 as md_sha256
      from market_bulletins where status = 'published'`;
  return {
    items,
    effective,
    bulletins: bulletins.map((row) => ({ period: row.period, pdfSha256: row.pdf_sha256, mdSha256: row.md_sha256 })),
  };
}
