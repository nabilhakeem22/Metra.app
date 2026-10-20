'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import type { ContractLineOptionsPage, LineSearchRequest } from '@/lib/contracts/queries';
import {
  createCostEntryCore,
  updateCostEntryCore,
  voidCostEntryCore,
  type CreateCostEntryInput,
  type UpdateCostEntryInput,
} from './core';
import { loadCostEntriesCore, loadCostSectionsCore, searchCostEntryLinesCore } from './reads';
import type { CostEntriesCursor, CostEntriesFilter, CostEntriesPage, CostSectionsPage } from './types';

/** "Record a cost". A replayed key answers `already: true`, and no answer carries the entry's id. */
export async function createCostEntry(input: CreateCostEntryInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await createCostEntryCore(ctx, input);
  if (!res.ok) return res;
  refreshApp();
  return { ok: true, already: res.already };
}

export async function updateCostEntry(input: UpdateCostEntryInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await updateCostEntryCore(ctx, input);
  if (res.ok) refreshApp();
  return res;
}

export async function voidCostEntry(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  const res = await voidCostEntryCore(ctx, { id });
  if (res.ok) refreshApp();
  return res;
}

/** The next page of entries, or the first one for a new filter. */
export async function loadCostEntries(request: {
  contractId: string;
  filter: CostEntriesFilter;
  cursor: CostEntriesCursor | null;
}): Promise<ActionResult & { data?: CostEntriesPage }> {
  const ctx = await requireOrg();
  return loadCostEntriesCore(ctx, request);
}

/** The contract's sections after the last one shown, for the costs filter and the entry form. */
export async function loadCostSections(request: {
  contractId: string;
  afterSectionId: string | null;
}): Promise<ActionResult & { data?: CostSectionsPage }> {
  const ctx = await requireOrg();
  return loadCostSectionsCore(ctx, request);
}

/** The entry form's line picker, on the member's contract line search budget (the variation picker's surface). */
export async function searchCostEntryLines(
  request: LineSearchRequest,
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  const ctx = await requireOrg();
  return (await studioReadRefusal(ctx, 'contract_line_search')) ?? searchCostEntryLinesCore(ctx, request);
}
