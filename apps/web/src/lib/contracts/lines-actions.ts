'use server';

import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { loadContractSectionsCore, loadSectionLinesCore, searchBaselineLinesCore } from './lines-core';
import type {
  ContractLineOptionsPage,
  ContractLinesPage,
  ContractSectionsPage,
  LineSearchRequest,
  SectionLinesRequest,
} from './queries';

/** The contract page's sections: the next page after the last one shown (lines-core.ts). */
export async function loadContractSections(request: {
  contractId: string;
  afterSectionId: string | null;
}): Promise<ActionResult & { data?: ContractSectionsPage }> {
  const ctx = await requireOrg();
  return loadContractSectionsCore(ctx, request);
}

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
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  const ctx = await requireOrg();
  return searchBaselineLinesCore(ctx, request);
}
