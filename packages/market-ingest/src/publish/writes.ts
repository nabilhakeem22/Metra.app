// The writes of one publish, each inside the caller's transaction. They trust
// staged.json's shape (it was hash-approved) but re-check what the database may
// have changed since the check ran: an item's unit and pack, a discontinue.
import type { Transaction } from '../db/connection';
import { packOf } from '../history/load';
import { describePack, samePack } from '../roll-pack';
import type { StagedBulletin, StagedItem } from '../stage';

type Tx = Transaction;

const OBSERVATION_BATCH = 500;

export async function upsertCategories(tx: Tx, staged: StagedBulletin): Promise<void> {
  for (const category of staged.categories) {
    await tx`
      insert into market_categories (key, parent_id, name_ar, name_en, sort_order)
      values (${category.key},
              (select id from market_categories where key = ${category.parentKey}),
              ${category.nameAr}, ${category.nameEn}, ${category.sortOrder})
      on conflict (key) do update
        set name_ar = excluded.name_ar, name_en = excluded.name_en, sort_order = excluded.sort_order`;
  }
}

async function insertItem(tx: Tx, item: StagedItem): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into market_items (key, category_id, name_ar, name_en, spec_ar, spec_en, unit, unit_label_ar,
      pack_length_m, pack_pieces, pack_piece_length_m, basis_note_ar, source_labels)
    values (${item.key}, (select id from market_categories where key = ${item.categoryKey}),
      ${item.nameAr}, ${item.nameEn}, ${item.specAr}, ${item.specEn}, ${item.unit}::market_unit, ${item.unitLabelAr},
      ${item.pack?.lengthM ?? null}, ${item.pack?.pieces ?? null}, ${item.pack?.pieceLengthM ?? null},
      ${item.basisNoteAr}, ${[item.sourceLabel]})
    returning id`;
  return row.id;
}

/** item key -> id, after inserting the new items and appending the labels of the known ones. */
export async function writeItems(tx: Tx, staged: StagedBulletin): Promise<{ ids: Map<string, string>; created: number }> {
  const keys = staged.items.map((item) => item.key);
  const existing = await tx<Array<{ id: string; key: string; unit: string; pack_length_m: string | null; pack_pieces: number | null; pack_piece_length_m: string | null }>>`
    select id, key, unit, pack_length_m, pack_pieces, pack_piece_length_m from market_items where key = any(${keys})`;
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const ids = new Map<string, string>();
  let created = 0;
  for (const item of staged.items) {
    const known = byKey.get(item.key);
    if (known === undefined) {
      ids.set(item.key, await insertItem(tx, item));
      created += 1;
      continue;
    }
    if (known.unit !== item.unit || !samePack(packOf(known), item.pack)) {
      throw new Error(`${item.key} is published in ${known.unit} (${describePack(packOf(known))}); staged.json says ${item.unit} (${describePack(item.pack)}). Run market:check again`);
    }
    await tx`
      update market_items
         set source_labels = case when ${item.sourceLabel} = any(source_labels) then source_labels
                                  else source_labels || array[${item.sourceLabel}]::text[] end,
             status = 'active', updated_at = now()
       where id = ${known.id}`;
    ids.set(item.key, known.id);
  }
  return { ids, created };
}

export async function discontinueItems(tx: Tx, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const done = await tx<{ key: string }[]>`
    update market_items set status = 'discontinued', updated_at = now()
     where key = any(${keys}) and status = 'active' returning key`;
  if (done.length !== keys.length) {
    const missing = keys.filter((key) => !done.some((row) => row.key === key));
    throw new Error(`cannot discontinue ${missing.join(', ')}: not an active published item`);
  }
}

export async function insertObservations(tx: Tx, staged: StagedBulletin, bulletinId: string, ids: Map<string, string>): Promise<void> {
  const rows = staged.observations.map((observation) => ({
    item_id: ids.get(observation.itemKey) as string,
    bulletin_id: bulletinId,
    period_month: `${observation.month}-01`,
    status: observation.status,
    price: observation.price,
    source_pdf_page: observation.pdfPage,
    source_printed_page: observation.printedPage,
  }));
  for (let start = 0; start < rows.length; start += OBSERVATION_BATCH) {
    const batch = rows.slice(start, start + OBSERVATION_BATCH);
    await tx`insert into market_price_observations ${tx(batch, 'item_id', 'bulletin_id', 'period_month', 'status', 'price', 'source_pdf_page', 'source_printed_page')}`;
  }
}
