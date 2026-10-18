import 'server-only';
// The contract page's two on-demand line reads, gated and checked before any
// SQL runs: one section's next lines (the page's "show lines"), and the
// variation form's baseline-line search. Reads only; the 'use server' wrappers
// in ./lines-actions.ts add the session.
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary, not what its declared type promised.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { isUuid, NOT_UUID, optionalUuid } from '@/lib/uuid';
import { listSectionLines, searchContractLines, type ContractLinesPage } from './queries';

/** The longest search the picker runs; longer input is cut, not refused. */
const MAX_LINE_SEARCH_LENGTH = 100;

type LinesAnswer = ActionResult & { data?: ContractLinesPage };

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

/** The next page of one section's lines, for anyone who may open the contract page. */
export async function loadSectionLinesCore(ctx: OrgContext, input: unknown): Promise<LinesAnswer> {
  if (!can(ctx.role, 'contracts_generate', 'read')) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const sectionId = fieldOf(input, 'sectionId');
  const afterLineId = optionalUuid(fieldOf(input, 'afterLineId'));
  if (!isUuid(contractId) || !isUuid(sectionId) || afterLineId === NOT_UUID) return err('malformed');
  try {
    return { ok: true, data: await listSectionLines(ctx, { contractId, sectionId, afterLineId }) };
  } catch (error) {
    return unexpectedFailure('contract section lines failed', error);
  }
}

/**
 * Baseline lines matching a search, for exactly who sees the picker: a role
 * that may open the contract page AND draft a variation order there. Drafting
 * alone is not enough; it would hand a contract's prices to a role that cannot
 * open the contract.
 */
export async function searchBaselineLinesCore(ctx: OrgContext, input: unknown): Promise<LinesAnswer> {
  const seesPicker =
    can(ctx.role, 'contracts_generate', 'read') && can(ctx.role, 'variations_draft', 'create');
  if (!seesPicker) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const query = fieldOf(input, 'query');
  if (!isUuid(contractId) || typeof query !== 'string') return err('malformed');
  try {
    const request = { contractId, query: query.slice(0, MAX_LINE_SEARCH_LENGTH) };
    return { ok: true, data: await searchContractLines(ctx, request) };
  } catch (error) {
    return unexpectedFailure('contract baseline line search failed', error);
  }
}
