'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { loadSectionLinesCore, searchBaselineLinesCore } from './lines-core';
import type { ContractLinesPage, LineSearchRequest, SectionLinesRequest } from './queries';

/** The contract page's "show lines": one section's next page (lines-core.ts). */
export async function loadSectionLines(
  request: SectionLinesRequest,
): Promise<ActionResult & { data?: ContractLinesPage }> {
  const ctx = await requireOrg();
  return loadSectionLinesCore(ctx, request);
}

/** The variation form's baseline-line picker, asked on demand (lines-core.ts). */
export async function searchBaselineLines(
  request: LineSearchRequest,
): Promise<ActionResult & { data?: ContractLinesPage }> {
  const ctx = await requireOrg();
  return searchBaselineLinesCore(ctx, request);
}
