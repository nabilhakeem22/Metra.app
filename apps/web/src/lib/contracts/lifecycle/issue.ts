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
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { validateSchedule } from '@/lib/execution/money/schedule';
import { isRecord } from '@/lib/guards/is-record';
import { mintShareToken, shareExpiryFromNow } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { loadScheduleRows } from '../schedule/queries';

/**
 * The contract row FOR UPDATE, before the schedule is read (plan A3.2
 * addendum): a schedule save still open on this contract finishes first, and
 * one that starts after waits for this issue and then meets MT100.
 */
async function lockContractForIssue(tx: MetraDb, contractId: string) {
  const [row] = await tx
    .select({
      status: contracts.status,
      sourceBoqId: contracts.sourceBoqId,
      originalValue: contracts.originalValue,
      taxAmount: contracts.taxAmount,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
    .for('update');
  if (!row) fail('record_not_found');
  if (row.status !== 'draft') fail('contract_not_draft');
  return row;
}

/**
 * An execution contract is issued with its payment schedule, which the client
 * signs with it (plan A6): none is `contract_schedule_missing`, one that no
 * longer adds up (the charges moved the value under amounts) is
 * `contract_schedule_invalid`. A proposal contract has no schedule to check.
 */
async function requireValidSchedule(
  tx: MetraDb,
  contractId: string,
  contract: { sourceBoqId: string | null; originalValue: string; taxAmount: string },
): Promise<void> {
  if (contract.sourceBoqId === null) return;
  const rows = await loadScheduleRows(tx, contractId);
  if (rows.length === 0) fail('contract_schedule_missing');
  if (!validateSchedule(rows, contract.originalValue, contract.taxAmount).ok) {
    fail('contract_schedule_invalid');
  }
}

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

/** What an issue hands its action wrapper. */
export interface IssuedContract {
  /** The contract's /c token, RAW: goes into a link once, never stored or logged. */
  rawToken: string;
  /** Generated from a BOQ: signed in the client home (H6.4), so its /c link is not handed out. */
  execution: boolean;
}

/**
 * Issue a draft contract: draft->issued, mint the client acknowledgement token,
 * write the event. Owner/admin only (contracts_issue). The transition IS the
 * admission gate — a concurrent 2nd issue finds status<>'draft' -> 0 rows ->
 * contract_not_draft, no 2nd token, no 2nd event. An execution contract also
 * needs a valid schedule; a refusal writes no token and no event. Returns the
 * RAW token and whether it is an execution contract (read under the lock); the
 * action wrapper turns that into the link the studio hands the client.
 */
export async function issueContractCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: IssuedContract }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const contractId = typeof input.id === 'string' ? input.id.trim() : '';
  if (!isUuid(contractId)) return err('malformed');
  return mutateInOrg(
    ctx,
    { capability: 'contracts_issue', action: 'approve' },
    async (tx, audit) => {
      const contract = await lockContractForIssue(tx, contractId);
      await requireValidSchedule(tx, contractId, contract);
      const { raw, hash } = mintShareToken();
      await issueDraftContract(tx, contractId, hash, shareExpiryFromNow());
      await recordIssuedEvent(tx, ctx, contractId);
      await audit({
        entity: 'contract',
        entityId: contractId,
        action: 'issue',
        before: { status: 'draft' },
        after: { status: 'issued' },
      });
      return { rawToken: raw, execution: contract.sourceBoqId !== null };
    },
  );
}
