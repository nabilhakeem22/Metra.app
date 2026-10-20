import 'server-only';
// The cost sheet tab's on-demand read (plan A5.3), gated before any SQL runs.
// Opening it is the `margin_pnl` read grant, studio roles only: owner, admin,
// project manager and accountant; the site engineer and the viewer cannot
// (AC31). The margin inside it is `resolveSeeMargin`: a project manager in a
// studio that hides margin from PMs gets the sheet with `margin = null`. The
// 'use server' wrapper in ./actions.ts adds the session.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { resolveSeeMargin } from '@/lib/org/queries';
import { isUuid } from '@/lib/uuid';
import type { CostSheet } from '../money/cost-sheet-types';
import { mayOpenCostSheet } from './access';
import { getCostSheet } from './queries';

export async function loadCostSheetCore(ctx: OrgContext, input: unknown): Promise<ActionResult & { data?: CostSheet }> {
  if (!mayOpenCostSheet(ctx.role)) return err('forbidden');
  const contractId = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).contractId : undefined;
  if (!isUuid(contractId)) return err('malformed');
  try {
    const sheet = await getCostSheet(ctx, contractId, await resolveSeeMargin(ctx));
    return sheet ? { ok: true, data: sheet } : err('record_not_found');
  } catch (error) {
    return unexpectedFailure('cost sheet read failed', error);
  }
}
