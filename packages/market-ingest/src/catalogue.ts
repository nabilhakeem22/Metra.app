// `market:catalogue`: the published items, for an extracting session to REUSE
// their keys (read-only). Written to <staging>/catalogue.json.
import type { PostgresJs } from './db/connection';
import { packOf } from './history/load';
import type { RollPack } from './roll-pack';
import type { MarketUnit } from './units';

export interface CatalogueItem {
  key: string;
  categoryKey: string;
  nameAr: string;
  nameEn: string;
  specAr: string | null;
  specEn: string | null;
  unit: MarketUnit;
  pack: RollPack | null;
  unitLabelAr: string;
  status: 'active' | 'discontinued';
  sourceLabels: string[];
}

export async function readCatalogue(sql: PostgresJs): Promise<CatalogueItem[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    select i.key, c.key as category_key, i.name_ar, i.name_en, i.spec_ar, i.spec_en, i.unit,
           i.pack_length_m, i.pack_pieces, i.pack_piece_length_m, i.unit_label_ar, i.status, i.source_labels
      from market_items i join market_categories c on c.id = i.category_id
     order by i.key collate "C"`;
  return rows.map((row) => ({
    key: row.key as string,
    categoryKey: row.category_key as string,
    nameAr: row.name_ar as string,
    nameEn: row.name_en as string,
    specAr: row.spec_ar as string | null,
    specEn: row.spec_en as string | null,
    unit: row.unit as MarketUnit,
    pack: packOf(row as Parameters<typeof packOf>[0]),
    unitLabelAr: row.unit_label_ar as string,
    status: row.status as CatalogueItem['status'],
    sourceLabels: row.source_labels as string[],
  }));
}
