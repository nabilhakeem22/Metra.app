// What refuses a contract on an issued BOQ once its status and its design are
// fine. Both run inside generateExecutionContractCore's transaction, after the BOQ
// is locked FOR SHARE (./create-from-boq.ts).
import { contracts, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { findDraftOf } from '@/lib/boqs/core/start-version';

/** The fast path of "one contract per BOQ"; the unique index is the real guard. */
export async function refuseSecondContract(tx: MetraDb, boqId: string): Promise<void> {
  const [existing] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.sourceBoqId, boqId))
    .limit(1);
  if (existing) fail('contract_exists');
}

/**
 * A draft on the project is what the tab shows in this BOQ's place, and a contract
 * on this BOQ would stop that draft being issued (`boq_has_contract`). A separate
 * statement AFTER the FOR SHARE lock, so it has its own snapshot: a new version that
 * held the BOQ FOR UPDATE (lib/boqs/core/start-version.ts) has committed by now and
 * its draft is seen here; one that comes later waits for this transaction, then sees
 * this contract.
 */
export async function refuseWhileVersionInProgress(tx: MetraDb, projectId: string): Promise<void> {
  if (await findDraftOf(tx, projectId)) fail('boq_version_in_progress');
}
