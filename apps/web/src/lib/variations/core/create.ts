// Variation-order creation: createVariationDraftCore. Opens a DRAFT VO against an
// ISSUED or SIGNED contract and allocates the per-org VO number (VO-YYYY-NNNN).
import { contracts, variationOrders } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { normalizeText } from '@/lib/proposals/core';
import { UUID_RE } from './shared';

export interface CreateVariationDraftInput {
  contractId: string;
  titleAr?: string | null;
  titleEn?: string | null;
  reasonAr?: string | null;
  reasonEn?: string | null;
}

/**
 * Create a DRAFT variation order against an ISSUED or SIGNED contract. Gate
 * variations_draft/create. Allocates the per-org VO number (VO-YYYY-NNNN).
 */
export async function createVariationDraftCore(
  ctx: OrgContext,
  input: CreateVariationDraftInput,
): Promise<ActionResult> {
  const contractId = input.contractId?.trim();
  if (!contractId || !UUID_RE.test(contractId)) return err('invalid');
  const titleAr = normalizeText(input.titleAr);
  const titleEn = normalizeText(input.titleEn);
  if (!titleAr && !titleEn) return err('name_required');

  return mutateInOrg(
    ctx,
    { capability: 'variations_draft', action: 'create' },
    async (tx, audit) => {
      const [contract] = await tx
        .select({ status: contracts.status, projectId: contracts.projectId })
        .from(contracts)
        .where(eq(contracts.id, contractId))
        .limit(1);
      if (!contract) fail('invalid');
      if (contract.status !== 'issued' && contract.status !== 'signed') {
        fail('contract_not_issued');
      }

      const number = await allocateNumber(
        tx,
        ctx.orgId,
        'variation_orders',
        'variation_orders',
        'number',
      );
      const [row] = await tx
        .insert(variationOrders)
        .values({
          orgId: ctx.orgId,
          number,
          contractId,
          projectId: contract.projectId,
          titleAr,
          titleEn,
          reasonAr: normalizeText(input.reasonAr),
          reasonEn: normalizeText(input.reasonEn),
        })
        .returning({ id: variationOrders.id });

      await audit({
        entity: 'variation_order',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { number, contract_id: contractId },
      });
      return row.id;
    },
  );
}
