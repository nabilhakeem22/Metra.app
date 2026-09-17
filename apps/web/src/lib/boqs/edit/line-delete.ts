import 'server-only';
import { boqLines } from '@metra/db';
import { eq } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { recomputeBoqTotals } from '../core';
import { loadDraftForLine } from './draft-guard';

/** Remove a line and re-roll. Deleting from a draft is not a soft delete: the
 *  document has not been issued, so there is no history to protect yet. */
export async function deleteBoqLineCore(
  ctx: OrgContext,
  input: { lineId: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      const { boqId, discountPct } = await loadDraftForLine(tx, input.lineId);
      await tx.delete(boqLines).where(eq(boqLines.id, input.lineId));
      await recomputeBoqTotals(tx, boqId, discountPct);
    },
  );
}
