import 'server-only';
// The client's "I paid" claims (B4) as the studio reads them: the pending ones
// of one contract for the Payments tab, and one claim locked for its answer.
// Inside the caller's org transaction: RLS scopes the table to the org, so a
// claim of another studio is never found.
import { contractPaymentClaims, type ClientPaymentClaimStatus, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { formatDocNumber } from '@/lib/format/doc-number';

/** At most one claim waits per request, and the tab shows the newest 100 requests. */
const PENDING_CLAIMS_SHOWN = 100;

export interface PendingClaimRow {
  id: string;
  requestId: string;
  /** The request it is on, PR-YYYY-NNNN. */
  requestNumber: string;
  /** What was still due when the client said they paid it: the confirm form opens on it. */
  claimedAmount: string;
  /** When the client sent it (an ISO instant). */
  claimedAt: string;
}

/** The contract's claims that wait for the studio, oldest first. */
export async function listPendingClaims(tx: MetraDb, contractId: string): Promise<PendingClaimRow[]> {
  const rows = (await tx.execute(sql`
    select c.id, c.request_id, c.claimed_amount::text as claimed_amount, c.created_at,
           r.number, extract(year from r.issued_on)::int as year
      from public.contract_payment_claims c
      join public.payment_requests r on r.id = c.request_id
     where c.contract_id = ${contractId} and c.status = 'pending'
     order by c.created_at, c.id
     limit ${PENDING_CLAIMS_SHOWN}
  `)) as unknown as Array<{ id: string; request_id: string; claimed_amount: string; created_at: string | Date; number: number; year: number }>;
  return rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    requestNumber: formatDocNumber('PR', row.number, row.year),
    claimedAmount: row.claimed_amount,
    claimedAt: new Date(row.created_at).toISOString(),
  }));
}

export interface LockedClaim {
  id: string;
  contractId: string;
  requestId: string;
  status: ClientPaymentClaimStatus;
  confirmedPaymentId: string | null;
}

/**
 * The claim row FOR UPDATE: the FIRST lock of both answers (plan lock order:
 * claim, then request), so a confirm and a dismiss of one claim queue here and
 * the second reads what the first committed. Absent or another studio's:
 * `claim_not_found`.
 */
export async function lockClaim(tx: MetraDb, claimId: string): Promise<LockedClaim> {
  const [row] = await tx
    .select({
      id: contractPaymentClaims.id,
      contractId: contractPaymentClaims.contractId,
      requestId: contractPaymentClaims.requestId,
      status: contractPaymentClaims.status,
      confirmedPaymentId: contractPaymentClaims.confirmedPaymentId,
    })
    .from(contractPaymentClaims)
    .where(eq(contractPaymentClaims.id, claimId))
    .limit(1)
    .for('update');
  if (!row) fail('claim_not_found');
  return row;
}
