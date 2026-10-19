import 'server-only';
import { LOCALES, type Locale } from '@/i18n/routing';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { MAX_SEARCH_LENGTH } from './page-params';
import { searchPickerItems } from './picker-query';
import type { PickerSearch } from './picker-types';

/**
 * The builder's "From price book" picker, asked on demand: at most PICKER_LIMIT
 * active items matching `query` (empty: the first ones), ordered for `locale`,
 * and how many matched. Reads only.
 *
 * Gated on EDITING a proposal (proposals_build update): a reader of the builder
 * cannot add a line, so has no picker. The cost comes back only to a role that
 * may see cost (canSeeMargin with the studio's hide-margin setting), as the
 * builder shows it; for anyone else the draft save takes the cost from the
 * price book itself.
 */
export async function searchPriceBookPickerCore(
  ctx: OrgContext,
  query: unknown,
  locale: unknown,
): Promise<ActionResult & { data?: PickerSearch }> {
  if (!can(ctx.role, 'proposals_build', 'update')) return err('forbidden');
  if (typeof query !== 'string' || !LOCALES.includes(locale as Locale)) return err('malformed');
  try {
    const withCost = await resolveSeeMargin(ctx);
    return { ok: true, data: await searchPickerItems(ctx, cleanSearchQuery(query, MAX_SEARCH_LENGTH), locale as Locale, withCost) };
  } catch (error) {
    return unexpectedFailure('price book picker search failed', error);
  }
}
