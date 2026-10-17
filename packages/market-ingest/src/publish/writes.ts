// The writes of one publish, each inside the caller's transaction and each ONE
// statement over the whole bulletin (jsonb_to_recordset), so a publish over a
// 100 ms link is a dozen round trips, not a thousand. They re-check what the
// database may have changed since the check ran: an item's unit and pack.
import type { Transaction } from '../db/connection';
import { packOf } from '../history/load';
import { describePack, samePack } from '../roll-pack';
import type { StagedBulletin, StagedCategory } from '../stage';

const OBSERVATION_BATCH = 500;

/** A jsonb parameter (postgres.js serialises it once; a pre-stringified value would be a jsonb string). */
const asJson = (tx: Transaction, rows: object[]) => tx.json(rows as unknown as Parameters<Transaction['json']>[0]);

async function upsertCategoryGroup(tx: Transaction, group: StagedCategory[]): Promise<void> {
  if (group.length === 0) return;
  const rows = group.map((category) => ({
    key: category.key, parent_key: category.parentKey, name_ar: category.nameAr, name_en: category.nameEn, sort_order: category.sortOrder,
  }));
  await tx`
    insert into market_categories (key, parent_id, name_ar, name_en, sort_order)
    select x.key, p.id, x.name_ar, x.name_en, x.sort_order
      from jsonb_to_recordset(${asJson(tx, rows)}) as x(key text, parent_key text, name_ar text, name_en text, sort_order integer)
      left join market_categories p on p.key = x.parent_key
    on conflict (key) do update
      set name_ar = excluded.name_ar, name_en = excluded.name_en, sort_order = excluded.sort_order`;
}

/** Tops first: a leaf's parent must exist before the statement that inserts the leaf. */
export async function upsertCategories(tx: Transaction, staged: StagedBulletin): Promise<void> {
  await upsertCategoryGroup(tx, staged.categories.filter((category) => category.parentKey === null));
  await upsertCategoryGroup(tx, staged.categories.filter((category) => category.parentKey !== null));
}

type ExistingItem = { id: string; key: string; unit: string; pack_length_m: string | null; pack_pieces: number | null; pack_piece_length_m: string | null };

/** item key -> id, after inserting the new items and appending the labels of the known ones. */
export async function writeItems(tx: Transaction, staged: StagedBulletin): Promise<{ ids: Map<string, string>; created: number }> {
  const existing = await tx<ExistingItem[]>`
    select id, key, unit, pack_length_m, pack_pieces, pack_piece_length_m from market_items where key = any(${staged.items.map((item) => item.key)})`;
  const byKey = new Map(existing.map((row) => [row.key, row]));
  for (const item of staged.items) {
    const known = byKey.get(item.key);
    if (known && (known.unit !== item.unit || !samePack(packOf(known), item.pack))) {
      throw new Error(`${item.key} is published in ${known.unit} (${describePack(packOf(known))}); this bulletin reads ${item.unit} (${describePack(item.pack)}). Run market:check again`);
    }
  }
  const fresh = staged.items.filter((item) => !byKey.has(item.key)).map((item) => ({
    key: item.key, category_key: item.categoryKey, name_ar: item.nameAr, name_en: item.nameEn, spec_ar: item.specAr, spec_en: item.specEn,
    unit: item.unit, unit_label_ar: item.unitLabelAr, pack_length_m: item.pack?.lengthM ?? null, pack_pieces: item.pack?.pieces ?? null,
    pack_piece_length_m: item.pack?.pieceLengthM ?? null, basis_note_ar: item.basisNoteAr, source_label: item.sourceLabel,
  }));
  const created = fresh.length === 0 ? [] : await tx<Array<{ id: string; key: string }>>`
    insert into market_items (key, category_id, name_ar, name_en, spec_ar, spec_en, unit, unit_label_ar,
      pack_length_m, pack_pieces, pack_piece_length_m, basis_note_ar, source_labels)
    select x.key, c.id, x.name_ar, x.name_en, x.spec_ar, x.spec_en, x.unit::market_unit, x.unit_label_ar,
           x.pack_length_m, x.pack_pieces, x.pack_piece_length_m, x.basis_note_ar, array[x.source_label]
      from jsonb_to_recordset(${asJson(tx, fresh)}) as x(key text, category_key text, name_ar text, name_en text,
             spec_ar text, spec_en text, unit text, unit_label_ar text, pack_length_m numeric, pack_pieces integer,
             pack_piece_length_m numeric, basis_note_ar text, source_label text)
      join market_categories c on c.key = x.category_key
    returning id, key`;
  if (created.length !== fresh.length) throw new Error('a new item names a category that does not exist; run market:check again');
  const known = staged.items.filter((item) => byKey.has(item.key)).map((item) => ({ key: item.key, source_label: item.sourceLabel }));
  if (known.length > 0) {
    await tx`
      update market_items i
         set source_labels = case when x.source_label = any(i.source_labels) then i.source_labels
                                  else i.source_labels || array[x.source_label] end,
             status = 'active', updated_at = now()
        from jsonb_to_recordset(${asJson(tx, known)}) as x(key text, source_label text)
       where i.key = x.key`;
  }
  const ids = new Map<string, string>([...existing, ...created].map((row) => [row.key, row.id]));
  return { ids, created: created.length };
}

/** The ids of the items this bulletin discontinues (each must exist). */
export async function discontinueItems(tx: Transaction, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const done = await tx<Array<{ id: string; key: string }>>`
    update market_items set status = 'discontinued', updated_at = now() where key = any(${keys}) returning id, key`;
  if (done.length !== keys.length) {
    const missing = keys.filter((key) => !done.some((row) => row.key === key));
    throw new Error(`cannot discontinue ${missing.join(', ')}: not a published item`);
  }
  return done.map((row) => row.id);
}

/** Every item's details as THIS bulletin printed them (studios' copies are derived from these). */
export async function insertDetails(tx: Transaction, staged: StagedBulletin, bulletinId: string): Promise<void> {
  const rows = staged.items.map((item) => ({
    key: item.key, name_ar: item.nameAr, name_en: item.nameEn, spec_ar: item.specAr, spec_en: item.specEn,
    unit_label_ar: item.unitLabelAr, basis_note_ar: item.basisNoteAr,
  }));
  await tx`
    insert into market_item_details (item_id, bulletin_id, name_ar, name_en, spec_ar, spec_en, unit_label_ar, basis_note_ar)
    select i.id, ${bulletinId}, x.name_ar, x.name_en, x.spec_ar, x.spec_en, x.unit_label_ar, x.basis_note_ar
      from jsonb_to_recordset(${asJson(tx, rows)}) as x(key text, name_ar text, name_en text, spec_ar text, spec_en text,
             unit_label_ar text, basis_note_ar text)
      join market_items i on i.key = x.key`;
}

export async function insertObservations(tx: Transaction, staged: StagedBulletin, bulletinId: string, ids: Map<string, string>): Promise<void> {
  const rows = staged.observations.map((observation) => ({
    item_id: ids.get(observation.itemKey) as string,
    bulletin_id: bulletinId,
    bulletin_period_month: `${staged.period}-01`,
    period_month: `${observation.month}-01`,
    status: observation.status,
    price: observation.price,
    source_pdf_page: observation.pdfPage,
    source_printed_page: observation.printedPage,
  }));
  for (let start = 0; start < rows.length; start += OBSERVATION_BATCH) {
    const batch = rows.slice(start, start + OBSERVATION_BATCH);
    await tx`insert into market_price_observations ${tx(batch, 'item_id', 'bulletin_id', 'bulletin_period_month', 'period_month', 'status', 'price', 'source_pdf_page', 'source_printed_page')}`;
  }
}
