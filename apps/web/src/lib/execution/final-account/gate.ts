import 'server-only';
// What an issued final account closes (plan A14): no new payment request
// (the request cores read it under their contract lock), no measurement and no
// change-order internal approval. Those two writers call this FIRST.
//
// LOCKS: the contract row FOR SHARE, before anything else of the contract is
// locked or written. The final account core holds the same row FOR UPDATE
// while it reads the open change orders and the measured works, so the two
// orders are serialised either way: a measurement or an approval that commits
// first is in the final account's figures (or refuses it, `open_variations`),
// and one that waits sees the final account once it may go on, and is
// refused here. Shared, so two measurements never wait on each other. A void
// of the final account (an unpaid one) lifts this again.
//
// The contract row is frozen once issued (MT100 on UPDATE); a row lock is not
// an UPDATE. Termination locks the contract and then its change orders, the
// order an approval takes them here.
import { contracts, type ContractStatus, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';

export interface HeldContract {
  id: string;
  status: ContractStatus;
  sourceBoqId: string | null;
}

/** Whether the contract's final account request is issued (not void). */
export async function isFinalAccountIssued(tx: MetraDb, contractId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select exists (select 1 from public.payment_requests r
                    where r.contract_id = ${contractId} and r.kind = 'final_account' and r.status = 'issued') as issued
  `)) as unknown as Array<{ issued: boolean }>;
  return rows[0].issued;
}

/** The contract held FOR SHARE (see above): the first lock its writer takes. */
export async function holdContract(tx: MetraDb, contractId: string): Promise<HeldContract> {
  const [row] = await tx
    .select({ id: contracts.id, status: contracts.status, sourceBoqId: contracts.sourceBoqId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
    .for('share');
  if (!row) fail('record_not_found');
  return row;
}

/** The contract held FOR SHARE, refused with `final_account_issued` once its final account is issued. */
export async function holdContractOpen(tx: MetraDb, contractId: string): Promise<HeldContract> {
  const contract = await holdContract(tx, contractId);
  if (await isFinalAccountIssued(tx, contractId)) fail('final_account_issued');
  return contract;
}
