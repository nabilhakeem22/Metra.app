// draft -> sent: mint the share token, open the client's window, tell the feed.
// Each state change is an ATOMIC admission gate (UPDATE ... WHERE status=...
// RETURNING, check rowCount) — never read-then-write — so concurrent callers
// cannot double-apply it.
// Accept/reject metadata lives in the append-only events table, because the row
// locks on send and cannot hold it.
import { proposalEvents, proposals, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { claimDailyEmail } from '@/lib/email/daily-caps';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';

/**
 * Flip draft -> sent and stamp the share token, returning the client the link is
 * for.
 *
 * R3: the transition IS the admission gate. A concurrent 2nd send finds
 * status<>'draft', affects 0 rows, fails `proposal_not_draft` — no event, no
 * second link, and the live token is never overwritten.
 */
async function sendDraftProposal(
  tx: MetraDb,
  proposalId: string,
  tokenHash: string,
  shareExpiresAt: Date,
): Promise<{ clientId: string }> {
  const gated = await tx
    .update(proposals)
    .set({ status: 'sent', tokenHash, shareExpiresAt, updatedAt: new Date() })
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.status, 'draft'),
        eq(proposals.kind, 'quote'),
      ),
    )
    .returning({ id: proposals.id, clientId: proposals.clientId });
  if (!gated[0]) fail('proposal_not_draft');
  return { clientId: gated[0].clientId };
}

/** The append-only ledger row for the transition, plus the client's feed entry. */
async function recordSentEvent(
  tx: MetraDb,
  ctx: OrgContext,
  proposalId: string,
  clientId: string,
): Promise<void> {
  await tx.insert(proposalEvents).values({
    orgId: ctx.orgId,
    proposalId,
    kind: 'sent',
    actorUserId: ctx.userId,
    fromStatus: 'draft',
    toStatus: 'sent',
  });
  await appendSystemActivity(tx, ctx, {
    entityType: 'client',
    entityId: clientId,
    kind: 'proposal_sent',
    meta: { proposal_id: proposalId },
  });
}

/**
 * A BOQ-kind proposal is the delivery's BOQ working copy and is sent from the
 * delivery page as a BOQ, never as a quote. Refused by name here; the admission
 * UPDATE below also requires `kind = 'quote'`, and the DB CHECK is the third
 * lock. A missing id is left to the admission gate, as before.
 */
async function refuseBoqProposal(tx: MetraDb, proposalId: string): Promise<void> {
  const [row] = await tx
    .select({ kind: proposals.kind })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (row?.kind === 'boq') fail('proposal_is_boq');
}

/** The whole send in one transaction: admission, the cap claim, the ledger row and the audit row. */
async function sendInTransaction(
  tx: MetraDb,
  ctx: OrgContext,
  proposalId: string,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<{ raw: string; emailAllowed: boolean }> {
  await refuseBoqProposal(tx, proposalId);
  const { raw, hash } = mintShareToken();
  const { clientId } = await sendDraftProposal(tx, proposalId, hash, shareExpiryFromNow());
  // Before the `sent` event it counts (lib/email/daily-caps.ts).
  const emailAllowed = await claimDailyEmail(tx, ctx.orgId, 'client_email');
  await recordSentEvent(tx, ctx, proposalId, clientId);
  await audit({
    entity: 'proposal',
    entityId: proposalId,
    action: 'issue',
    before: { status: 'draft' },
    after: { status: 'sent' },
  });
  return { raw, emailAllowed };
}

/**
 * `data` is the raw share token (the action wrapper turns it into the public
 * link). `emailAllowed` says whether the client email is within the studio's
 * daily cap; the send itself never depends on it.
 */
export async function sendProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string; emailAllowed?: boolean }> {
  const { data: sent, ...outcome } = await mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    (tx, audit) => sendInTransaction(tx, ctx, input.id, audit),
  );
  return sent ? { ...outcome, data: sent.raw, emailAllowed: sent.emailAllowed } : outcome;
}
