'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import { loadSectionLinesCore, searchBaselineLinesCore } from './lines-core';
import type {
  ContractLineOptionsPage,
  ContractLinesPage,
  LineSearchRequest,
  SectionLinesRequest,
} from './queries';

/** The contract page's "show lines": one section's next page (lines-core.ts). */
export async function loadSectionLines(
  request: SectionLinesRequest,
): Promise<ActionResult & { data?: ContractLinesPage }> {
  const ctx = await requireOrg();
  return loadSectionLinesCore(ctx, request);
}

/** The variation form's baseline-line picker, asked on demand (lines-core.ts), on the member's studio read budget. */
export async function searchBaselineLines(
  request: LineSearchRequest,
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  const ctx = await requireOrg();
  return (await studioReadRefusal(ctx, 'contract_line_search')) ?? searchBaselineLinesCore(ctx, request);
}
