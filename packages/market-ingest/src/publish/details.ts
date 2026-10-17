// The item columns studios read (names, spec, unit label, basis note) are a
// copy of the NEWEST PUBLISHED bulletin's market_item_details row. Re-derived
// after every publish and every withdrawal, so a corrected --replace corrects
// what studios see and a withdrawal restores the previous bulletin's wording.
import type { Transaction } from '../db/connection';

export async function refreshItemDetails(tx: Transaction, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await tx`
    update market_items i
       set name_ar = d.name_ar, name_en = d.name_en, spec_ar = d.spec_ar, spec_en = d.spec_en,
           unit_label_ar = d.unit_label_ar, basis_note_ar = d.basis_note_ar, updated_at = now()
      from (select distinct on (d.item_id) d.*
              from market_item_details d
              join market_bulletins b on b.id = d.bulletin_id and b.status = 'published'
             where d.item_id = any(${itemIds}::uuid[])
             order by d.item_id, b.period_month desc) d
     where i.id = d.item_id`;
}
