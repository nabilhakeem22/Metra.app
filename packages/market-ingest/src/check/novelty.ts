// F4: an item key the published catalogue does not know yet. With --offline the
// history is empty, so every item is new; that is honest, not noise.
import { finding, type Finding } from '../findings';
import type { CheckContext } from './context';

export function checkNewItems(context: CheckContext): Finding[] {
  return context.rows
    .filter((resolved) => !context.history.items.has(resolved.itemKey))
    .map((resolved) =>
      finding('F4', `new item ${resolved.itemKey}: "${resolved.row.labelAr}${resolved.row.specAr ? ` ${resolved.row.specAr}` : ''}" / ${resolved.row.nameEn}`, {
        rowId: resolved.row.rowId,
        page: resolved.pageId,
      }),
    );
}
