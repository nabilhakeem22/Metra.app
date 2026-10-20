import 'server-only';
import type { ActionResult } from '@/lib/actions/result';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import type { OrgContext } from '@/lib/db/context';
import type { MarketBookView } from './page-params';

/**
 * A search (a non-empty `q`) is charged to the member's search budget
 * (STUDIO_SEARCH_RATE_LIMITER, surface `market_search`): it is the page's one
 * read whose cost grows with the matches. A category page is not charged.
 * Null when the page may read; else the refusal to show (`rate_limited`, or a
 * logged `generic` with its reference when the limiter is missing).
 */
export async function marketSearchRefusal(ctx: OrgContext, view: MarketBookView): Promise<ActionResult | null> {
  return view.query === '' ? null : studioReadRefusal(ctx, 'market_search');
}
