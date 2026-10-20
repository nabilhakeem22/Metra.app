import 'server-only';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import { readMarketItem } from './queries';
import type { MarketItemDetail } from './types';

/**
 * The market item drawer, asked on demand (its own request, so opening a
 * drawer never re-reads the page). Gated as the page is: price_book read.
 */
export async function readMarketItemCore(
  ctx: OrgContext,
  marketItemId: unknown,
): Promise<ActionResult & { data?: MarketItemDetail }> {
  if (!can(ctx.role, 'price_book', 'read')) return err('forbidden');
  if (!isUuid(marketItemId)) return err('malformed');
  try {
    const item = await readMarketItem(ctx, marketItemId);
    return item ? { ok: true, data: item } : err('market_item_not_found');
  } catch (error) {
    return unexpectedFailure('market item read failed', error);
  }
}
