'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { searchPriceBookPickerCore } from './picker-core';
import type { PickerSearch } from './picker-types';

/** The builder's "From price book" picker, asked on demand (picker-core.ts). */
export async function searchPriceBookPicker(
  query: string,
  locale: string,
): Promise<ActionResult & { data?: PickerSearch }> {
  const ctx = await requireOrg();
  return searchPriceBookPickerCore(ctx, query, locale);
}
