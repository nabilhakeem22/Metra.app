import 'server-only';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import { getProposalWithLines } from './detail';
import type { ProposalDetail } from './detail-types';

/**
 * The draft as it is stored NOW, margin-gated exactly as the builder page loads
 * it (no field the caller could not already read there). The builder asks for
 * it when a save is refused as `draft_changed_elsewhere`, to tell its OWN lost
 * commit (a save whose answer never arrived) from another tab's edit.
 */
export async function readStoredDraftCore(
  ctx: OrgContext,
  id: string,
): Promise<ActionResult & { data?: ProposalDetail }> {
  if (!can(ctx.role, 'proposals_build', 'read')) return err('forbidden');
  if (!isUuid(id)) return err('invalid');
  const detail = await getProposalWithLines(ctx, id, await resolveSeeMargin(ctx));
  if (!detail) return err('invalid');
  if (detail.status !== 'draft') return err('proposal_not_draft');
  return { ok: true, data: detail };
}
