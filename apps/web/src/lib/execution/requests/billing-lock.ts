import 'server-only';
// The first step of every payment request writer: the contract row FOR UPDATE,
// then the refusals of a contract that cannot be billed.
//
// LOCK ORDER (plan "Lock order for every money writer", extended): contract ->
// request -> payment. The issue cores take the contract and insert; the void
// core takes the contract, then the request. Nothing takes a request and then
// its contract, and the payment and claim writers never take the contract, so
// the order has no cycle. Holding the contract serialises every request writer
// of one contract: two sends of one milestone (the loser meets the partial
// unique, `request_exists`), a send against the final account (A5 issues it
// under the same lock), and a void against the final account (A4.1 addendum).
//
// The contract row is frozen once issued (MT100 on UPDATE), and a row lock is
// not an UPDATE: `FOR UPDATE` writes nothing the trigger would see.
//
// Every writer that takes this lock opens its transaction with
// `capTransaction` (mutateInOrg): FOR SHARE holders (measurements, approvals,
// ../final-account/gate.ts) do not queue behind a waiting FOR UPDATE, so a
// steady stream of them could otherwise hold the writer until
// statement_timeout (A5 R1); the caps (7 s a statement, 8 s the transaction,
// packages/db org-context.ts) end it at about 7 s as `uncertain`.
import { contracts, type ContractStatus, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';

export interface BillableContract {
  id: string;
  status: ContractStatus;
  originalValue: string;
  taxAmount: string;
  taxRate: string;
  supervisionPct: string;
  discountPct: string;
}

/** The contract locked, whatever its state: the void core reads it this way. */
export async function lockExecutionContract(tx: MetraDb, contractId: string): Promise<BillableContract> {
  const [row] = await tx
    .select({
      id: contracts.id,
      status: contracts.status,
      sourceBoqId: contracts.sourceBoqId,
      originalValue: contracts.originalValue,
      taxAmount: contracts.taxAmount,
      taxRate: contracts.taxRate,
      supervisionPct: contracts.supervisionPct,
      discountPct: contracts.discountPct,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
    .for('update');
  if (!row) fail('record_not_found');
  // Execution features apply only to a contract generated from a BOQ (plan A1).
  if (row.sourceBoqId === null) fail('contract_not_execution');
  return row;
}

/**
 * The contract locked, and billable: signed (decision D5), not terminated. A
 * draft or a sent but unsigned contract is `contract_not_signed`.
 */
export async function lockBillableContract(tx: MetraDb, contractId: string): Promise<BillableContract> {
  const contract = await lockExecutionContract(tx, contractId);
  if (contract.status === 'terminated') fail('contract_not_active');
  if (contract.status !== 'signed') fail('contract_not_signed');
  return contract;
}
