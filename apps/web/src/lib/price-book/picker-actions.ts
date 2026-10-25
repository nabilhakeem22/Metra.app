'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import { searchPriceBookPickerCore } from './picker-core';
import type { PickerSearch } from './picker-types';

/** The builder's "From price book" picker, asked on demand (picker-core.ts), on the member's studio read budget. */
export async function searchPriceBookPicker(
  query: string,
  locale: string,
): Promise<ActionResult & { data?: PickerSearch }> {
  const ctx = await requireOrg();
  return (await studioReadRefusal(ctx, 'price_book_picker')) ?? searchPriceBookPickerCore(ctx, query, locale);
}
