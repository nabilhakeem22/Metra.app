import 'server-only';
// The contract page's on-demand reads, gated and checked before any SQL runs:
// the next page of sections (the page's "show more sections"), one section's
// next lines (its "show lines"), and the variation form's baseline-line search. Reads only; the 'use server' wrappers
// in ./lines-actions.ts add the session.
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary, not what its declared type promised.
// A contract, section or cursor the caller cannot see (another studio's, after
// a studio switch in another tab) or that does not exist answers
// `record_not_found`, the same for both: never an empty page that reads as
// "no more lines".
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { isUuid, NOT_UUID, optionalUuid } from '@/lib/uuid';
import {
  getContractSectionsPage,
  listSectionLines,
  searchContractLines,
  type ContractLineOptionsPage,
  type ContractLinesPage,
  type ContractSectionsPage,
} from './queries';

/** The longest search the picker runs; longer input is cut, not refused. */
const MAX_LINE_SEARCH_LENGTH = 100;

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

/** The answer, or `record_not_found` when the read said the position is not the caller's. */
function found<T>(page: T | null): ActionResult & { data?: T } {
  return page ? { ok: true, data: page } : err('record_not_found');
}

/** The next page of the contract's sections, for anyone who may open the contract page. */
export async function loadContractSectionsCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractSectionsPage }> {
  if (!can(ctx.role, 'contracts_generate', 'read')) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const afterSectionId = optionalUuid(fieldOf(input, 'afterSectionId'));
  if (!isUuid(contractId) || afterSectionId === NOT_UUID) return err('malformed');
  try {
    return found(await getContractSectionsPage(ctx, contractId, afterSectionId));
  } catch (error) {
    return unexpectedFailure('contract sections failed', error);
  }
}

/** The next page of one section's lines, for anyone who may open the contract page. */
export async function loadSectionLinesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractLinesPage }> {
  if (!can(ctx.role, 'contracts_generate', 'read')) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const sectionId = fieldOf(input, 'sectionId');
  const afterLineId = optionalUuid(fieldOf(input, 'afterLineId'));
  if (!isUuid(contractId) || !isUuid(sectionId) || afterLineId === NOT_UUID) return err('malformed');
  try {
    return found(await listSectionLines(ctx, { contractId, sectionId, afterLineId }));
  } catch (error) {
    return unexpectedFailure('contract section lines failed', error);
  }
}

/**
 * Baseline lines matching a search, a page at a time, for exactly who sees the
 * picker: a role that may open the contract page AND draft a variation order
 * there. Drafting alone is not enough; it would hand a contract's prices to a
 * role that cannot open the contract.
 */
export async function searchBaselineLinesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: ContractLineOptionsPage }> {
  const seesPicker =
    can(ctx.role, 'contracts_generate', 'read') && can(ctx.role, 'variations_draft', 'create');
  if (!seesPicker) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const query = fieldOf(input, 'query');
  const afterLineId = optionalUuid(fieldOf(input, 'afterLineId'));
  if (!isUuid(contractId) || typeof query !== 'string' || afterLineId === NOT_UUID) return err('malformed');
  try {
    const request = { contractId, query: cleanSearchQuery(query, MAX_LINE_SEARCH_LENGTH), afterLineId };
    return found(await searchContractLines(ctx, request));
  } catch (error) {
    return unexpectedFailure('contract baseline line search failed', error);
  }
}
