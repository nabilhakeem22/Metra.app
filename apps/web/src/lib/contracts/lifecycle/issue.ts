// draft -> issued: mint the client acknowledgement token and open the signing
// window.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Client-facing acknowledgement (issued->signed) is NOT here: it is the
// unauthenticated token path (app_contract_ack_by_token), never the capability
// matrix.
import { contractEvents, contracts, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';

/**
 * Flip draft -> issued and stamp the acknowledgement token.
 *
 * A concurrent 2nd issue finds status<>'draft', affects 0 rows and fails
 * `contract_not_draft` — no 2nd token, no 2nd event, and the live token is never
 * overwritten.
 */
async function issueDraftContract(
  tx: MetraDb,
  contractId: string,
  tokenHash: string,
  shareExpiresAt: Date,
): Promise<void> {
  const gated = await tx
    .update(contracts)
    .set({ status: 'issued', tokenHash, shareExpiresAt, updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), eq(contracts.status, 'draft')))
    .returning({ id: contracts.id });
  if (!gated[0]) fail('contract_not_draft');
}

/** The append-only ledger row for the transition. */
async function recordIssuedEvent(
  tx: MetraDb,
  ctx: OrgContext,
  contractId: string,
): Promise<void> {
  await tx.insert(contractEvents).values({
    orgId: ctx.orgId,
    contractId,
    kind: 'issued',
    actorUserId: ctx.userId,
    fromStatus: 'draft',
    toStatus: 'issued',
  });
}

/**
 * Issue a draft contract: draft->issued, mint the client acknowledgement token,
 * write the event. Owner/admin only (contracts_issue). The transition IS the
 * admission gate — a concurrent 2nd issue finds status<>'draft' -> 0 rows ->
 * contract_not_draft, no 2nd token, no 2nd event. Returns the RAW token; the
 * action wrapper turns it into the public acknowledgement link.
 */
export async function issueContractCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'contracts_issue', action: 'approve' },
    async (tx, audit) => {
      const { raw, hash } = mintShareToken();
      await issueDraftContract(tx, input.id, hash, shareExpiryFromNow());
      await recordIssuedEvent(tx, ctx, input.id);
      await audit({
        entity: 'contract',
        entityId: input.id,
        action: 'issue',
        before: { status: 'draft' },
        after: { status: 'issued' },
      });
      return raw;
    },
  );
}
