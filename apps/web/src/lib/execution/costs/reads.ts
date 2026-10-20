import 'server-only';
// The Costs tab's two on-demand reads, gated and shape-checked before any SQL
// runs: the next page (or a new filter) of the entries, and the form's search
// for the contract line an entry is booked to. Reads only; the 'use server'
// wrappers in ./actions add the session (and the search budget).
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary, not what its declared type promised.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { searchContractLines, type ContractLineOptionsPage } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { isUuid, NOT_UUID, optionalUuid } from '@/lib/uuid';
import { validIsoDate } from '@/lib/validation/iso-date';
import { listCostEntries, type CostEntriesRequest } from './queries';
import { COST_ENTRY_CATEGORIES, type CostEntriesCursor, type CostEntriesPage } from './types';

/** The longest line search the form runs; longer input is cut, not refused. */
const MAX_LINE_SEARCH_LENGTH = 100;

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

/** Who sees the Costs tab: a role that may open the contract page AND read its costs. */
export function mayReadCostEntries(role: OrgContext['role']): boolean {
  return can(role, 'contracts_generate', 'read') && can(role, 'cost_entries', 'read');
}

/** Who sees the entry form: a role that may open the contract page AND record or edit a cost. */
export function mayWriteCostEntries(role: OrgContext['role']): boolean {
  return can(role, 'contracts_generate', 'read') && (can(role, 'cost_entries', 'create') || can(role, 'cost_entries', 'update'));
}

/** A cursor as the previous page handed it out, or undefined when it is not one. */
function readCursor(value: unknown): CostEntriesCursor | null | undefined {
  if (value === null || value === undefined) return null;
  const incurredOn = fieldOf(value, 'incurredOn');
  const id = fieldOf(value, 'id');
  return typeof incurredOn === 'string' && validIsoDate(incurredOn) && isUuid(id) ? { incurredOn, id } : undefined;
}

function readRequest(input: unknown): CostEntriesRequest | null {
  const contractId = fieldOf(input, 'contractId');
  const filter = fieldOf(input, 'filter');
  const rawCategory = fieldOf(filter, 'category');
  const category = rawCategory === null ? null : COST_ENTRY_CATEGORIES.find((known) => known === rawCategory);
  const sectionId = optionalUuid(fieldOf(filter, 'sectionId'));
  const cursor = readCursor(fieldOf(input, 'cursor'));
  if (!isUuid(contractId) || category === undefined || sectionId === NOT_UUID || cursor === undefined) return null;
  return { contractId, filter: { category, sectionId }, cursor };
}

/** A page of a contract's entries for the filter; `record_not_found` when the contract is not the caller's. */
export async function loadCostEntriesCore(ctx: OrgContext, input: unknown): Promise<ActionResult & { data?: CostEntriesPage }> {
  if (!mayReadCostEntries(ctx.role)) return err('forbidden');
  const request = readRequest(input);
  if (!request) return err('malformed');
  try {
    const page = await listCostEntries(ctx, request);
    return page ? { ok: true, data: page } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('cost entries read failed', error);
  }
}

/** The contract's lines matching a search, 50 at a time, for the entry form's line picker. */
export async function searchCostEntryLinesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  if (!mayWriteCostEntries(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const query = fieldOf(input, 'query');
  const afterLineId = optionalUuid(fieldOf(input, 'afterLineId'));
  if (!isUuid(contractId) || typeof query !== 'string' || afterLineId === NOT_UUID) return err('malformed');
  try {
    const page = await searchContractLines(ctx, { contractId, query: cleanSearchQuery(query, MAX_LINE_SEARCH_LENGTH), afterLineId });
    return page ? { ok: true, data: page } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('cost entry line search failed', error);
  }
}
