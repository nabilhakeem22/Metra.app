import 'server-only';
// The measurements tab's on-demand read, gated and checked before any SQL
// runs: the contract's state (status, issue day, final account) and one page
// of its lines with their final measured quantities. Asked when the tab opens,
// for each "show more", for each filter or search, and after each reading it
// records. The 'use server' wrapper in ./actions.ts adds the session.
//
// The input is `unknown` ON PURPOSE: what reaches a server action is whatever
// was serialised across the boundary. A contract the caller cannot see, one
// that is not an execution contract, or a cursor line outside it answers
// `record_not_found`, never an empty page that reads as "no more lines".
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { isKnownContractPosition } from '@/lib/contracts/queries/line-positions';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { isUuid, NOT_UUID, optionalUuid } from '@/lib/uuid';
import { mayReadMeasurements } from './access';
import { loadMeasurementContract, type MeasurementContractView } from './contract-view';
import { listMeasurableLines, type MeasurableLinesPage } from './queries';

/** The longest search the tab runs; longer input is cut, not refused. */
const MAX_SEARCH_LENGTH = 100;

export interface MeasurementsView {
  contract: MeasurementContractView;
  page: MeasurableLinesPage;
}

function fieldOf(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

export async function loadMeasurementsCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: MeasurementsView }> {
  if (!mayReadMeasurements(ctx.role)) return err('forbidden');
  const contractId = fieldOf(input, 'contractId');
  const afterLineId = optionalUuid(fieldOf(input, 'afterLineId'));
  const provisionalOnly = fieldOf(input, 'provisionalOnly');
  const query = fieldOf(input, 'query');
  if (!isUuid(contractId) || afterLineId === NOT_UUID || typeof provisionalOnly !== 'boolean' || typeof query !== 'string') {
    return err('malformed');
  }
  try {
    const view = await withOrgContext(ctx, async (tx) => {
      const contract = await loadMeasurementContract(tx, contractId);
      if (!contract) return null;
      const request = { afterLineId, provisionalOnly, query: cleanSearchQuery(query, MAX_SEARCH_LENGTH) };
      const page = await listMeasurableLines(tx, contractId, request);
      if (page.lines.length === 0 && !(await isKnownContractPosition(tx, { contractId, afterLineId }))) return null;
      return { contract, page };
    });
    return view ? { ok: true, data: view } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('contract measurements read failed', error);
  }
}
