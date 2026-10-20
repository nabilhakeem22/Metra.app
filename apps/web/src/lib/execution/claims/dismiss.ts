// dismissContractClaimCore: the studio answers a client's "I paid" with "not
// received" (B4.2). The claim becomes `dismissed`, stamped with who and when,
// and NO payment is written. Its pending slot frees, so the client may say they
// paid that request again later (the flood ceiling of the client's write still
// counts every claim).
//
// The claim is locked FOR UPDATE first, as the confirm core locks it, so of a
// concurrent confirm and dismiss of one claim exactly one lands (AC36): the
// second reads the committed status and answers `claim_not_found`. The flip is
// guarded on `status = 'pending'`; 0 rows rolls the transaction back.
import { contractPaymentClaims } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { lockClaim } from './queries';

export interface DismissContractClaimInput {
  claimId?: unknown;
}

export async function dismissContractClaimCore(ctx: OrgContext, input: DismissContractClaimInput): Promise<ActionResult> {
  if (!isRecord(input)) return err('malformed');
  const claimId = typeof input.claimId === 'string' ? input.claimId.trim() : '';
  if (!isUuid(claimId)) return err('malformed');

  return mutateInOrg(ctx, { capability: 'payments', action: 'update' }, async (tx, audit) => {
    const claim = await lockClaim(tx, claimId);
    if (claim.status !== 'pending') fail('claim_not_found');
    const flipped = await tx
      .update(contractPaymentClaims)
      .set({ status: 'dismissed', resolvedBy: ctx.userId, resolvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(contractPaymentClaims.id, claim.id), eq(contractPaymentClaims.status, 'pending')))
      .returning({ id: contractPaymentClaims.id });
    if (flipped.length === 0) fail('claim_not_found');
    await audit({
      entity: 'contract_payment_claim',
      entityId: claim.id,
      action: 'update',
      before: { status: 'pending' },
      after: { status: 'dismissed' },
    });
  });
}
