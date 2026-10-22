import 'server-only';
// The cost surfaces' on-demand reads, gated and shape-checked before any SQL
// runs: the next page (or a new filter) of the entries, the sections a cost
// is booked to or filtered by, and the form's search for the contract line an
// entry is booked to. Reads only; the 'use server' wrappers in ./actions add
// the session (and the search budget).
//
// Each is gated on the `cost_entries` row alone (./access.ts): a project
// manager or a site engineer reads and records costs without the contract
// page, so none of these answers carries the contract's money. The entries
// list is further scoped by the margin rule: a member who may not see margin
// gets only the entries it recorded and no totals. The line search answers
// descriptions and section titles only.
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary, not what its declared type promised.
import { fieldsFailed } from '@/lib/actions/field-errors';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { searchContractLines, type ContractLineOptionsPage } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { resolveSeeMargin } from '@/lib/org/queries';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { isUuid, NOT_UUID, optionalUuid } from '@/lib/uuid';
import { validIsoDate } from '@/lib/validation/iso-date';
import { costEntriesScopeFor, mayReadCostEntries, maySearchCostEntryLines } from './access';
import { listCostSections } from './contract-view';
import { listCostEntries, type CostEntriesRequest } from './queries';
import {
  COST_ENTRY_CATEGORIES,
  EARLIEST_COST_DAY,
  type CostEntriesCursor,
  type CostEntriesPage,
  type CostSectionsPage,
} from './types';

/** The longest line search the form runs; longer input is cut, not refused. */
const MAX_LINE_SEARCH_LENGTH = 100;

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

type CursorRead = { ok: true; cursor: CostEntriesCursor | null } | { ok: false; outOfRange: boolean };

/**
 * A cursor as the previous page handed it out. One naming a day no entry can
 * have (before EARLIEST_COST_DAY, year 0000 among them) is said as a date
 * refusal, never sent to Postgres, which would refuse year 0000 itself.
 */
function readCursor(value: unknown): CursorRead {
  if (value === null || value === undefined) return { ok: true, cursor: null };
  const incurredOn = fieldOf(value, 'incurredOn');
  const id = fieldOf(value, 'id');
  if (typeof incurredOn !== 'string' || !validIsoDate(incurredOn) || !isUuid(id)) return { ok: false, outOfRange: false };
  if (incurredOn < EARLIEST_COST_DAY) return { ok: false, outOfRange: true };
  return { ok: true, cursor: { incurredOn, id } };
}

type RequestRead = { ok: true; request: CostEntriesRequest } | { ok: false; answer: ActionResult };

function readRequest(input: unknown): RequestRead {
  const contractId = fieldOf(input, 'contractId');
  const filter = fieldOf(input, 'filter');
  const rawCategory = fieldOf(filter, 'category');
  const category = rawCategory === null ? null : COST_ENTRY_CATEGORIES.find((known) => known === rawCategory);
  const sectionId = optionalUuid(fieldOf(filter, 'sectionId'));
  const cursor = readCursor(fieldOf(input, 'cursor'));
  if (!isUuid(contractId) || category === undefined || sectionId === NOT_UUID) return { ok: false, answer: err('malformed') };
  if (!cursor.ok) {
    return { ok: false, answer: cursor.outOfRange ? fieldsFailed({ cursor: { code: 'invalid_date' } }) : err('malformed') };
  }
  return { ok: true, request: { contractId, filter: { category, sectionId }, cursor: cursor.cursor } };
}

/**
 * A page of a contract's entries for the filter: all of them with the totals
 * for a member who may see margin, only its own and no totals for one who may
 * not (./access.ts). `record_not_found` when the contract is not the caller's.
 */
export async function loadCostEntriesCore(ctx: OrgContext, input: unknown): Promise<ActionResult & { data?: CostEntriesPage }> {
  if (!mayReadCostEntries(ctx.role)) return err('forbidden');
  const read = readRequest(input);
  if (!read.ok) return read.answer;
  try {
    const page = await listCostEntries(ctx, read.request, costEntriesScopeFor(await resolveSeeMargin(ctx)));
    return page ? { ok: true, data: page } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('cost entries read failed', error);
  }
}

/** The contract's sections, a page at a time, for the costs filter and the entry form. */
export async function loadCostSectionsCore(ctx: OrgContext, input: unknown): Promise<ActionResult & { data?: CostSectionsPage }> {
  if (!mayReadCostEntries(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const afterSectionId = optionalUuid(fieldOf(input, 'afterSectionId'));
  if (!isUuid(contractId) || afterSectionId === NOT_UUID) return err('malformed');
  try {
    const page = await listCostSections(ctx, contractId, afterSectionId);
    return page ? { ok: true, data: page } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('cost sections read failed', error);
  }
}

/** The contract's lines matching a search, 50 at a time, for the entry form's line picker: no prices. */
export async function searchCostEntryLinesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  if (!maySearchCostEntryLines(ctx.role)) return err('forbidden');
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
