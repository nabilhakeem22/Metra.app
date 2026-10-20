'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import type { CostSheet } from '../money/cost-sheet-types';
import { loadCostSheetCore } from './read-core';

/** The cost sheet tab, read when it is shown (read-core.ts). */
export async function loadCostSheet(request: { contractId: string }): Promise<ActionResult & { data?: CostSheet }> {
  const ctx = await requireOrg();
  return loadCostSheetCore(ctx, request);
}
