'use server';

import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { LOCALES, type Locale } from '@/i18n/routing';
import { can } from '@/lib/permissions/can';
import { MAX_SEARCH_LENGTH } from './page-params';
import { searchPickerItems } from './picker-query';
import type { PickerSearch } from './picker-types';

/**
 * The builder's "From price book" picker, asked on demand: at most PICKER_LIMIT
 * active items matching `query` (empty: the first ones), ordered for `locale`,
 * and how many matched. The same gate as the builder page; reads only.
 */
export async function searchPriceBookPicker(
  query: string,
  locale: string,
): Promise<ActionResult & { data?: PickerSearch }> {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) return err('forbidden');
  if (typeof query !== 'string' || !LOCALES.includes(locale as Locale)) return err('malformed');
  try {
    return { ok: true, data: await searchPickerItems(ctx, query.slice(0, MAX_SEARCH_LENGTH), locale) };
  } catch (error) {
    return unexpectedFailure('price book picker search failed', error);
  }
}
