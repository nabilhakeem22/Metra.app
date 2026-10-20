import 'server-only';
// An execution contract's status and money basis (value, VAT, rates, document
// discount): what the Payments tab, the final account and the cost sheet read
// first. Null when the contract is not one the caller can see (RLS) or is not
// an execution contract (from a BOQ). No lock: the writers lock on their own.
import { contracts, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';

export async function loadExecutionContract(tx: MetraDb, contractId: string) {
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
    .limit(1);
  return row && row.sourceBoqId !== null ? row : null;
}

export type ExecutionContractBasis = NonNullable<Awaited<ReturnType<typeof loadExecutionContract>>>;
