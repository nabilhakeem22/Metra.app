// The Charges form's save: setContractChargesCore. Re-prices a DRAFT execution
// contract's VAT and supervision fee on its frozen works value (the BOQ total,
// stored as `taxable_base`); every other figure stays as it was generated.
import { contracts, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { contractTotalsFromBoq } from '@/lib/execution/money/charges';
import { isUuid } from '@/lib/uuid';
import { readContractCharges, type ContractChargesInput } from '../charges-input';

export interface SetContractChargesInput extends ContractChargesInput {
  contractId?: unknown;
}

/**
 * The draft execution contract, locked FOR UPDATE before anything is read off
 * it (the lock-order rule): its status, and the BOQ figures it was built on.
 */
async function lockDraftExecutionContract(tx: MetraDb, contractId: string) {
  const [row] = await tx
    .select({
      status: contracts.status,
      sourceBoqId: contracts.sourceBoqId,
      subtotal: contracts.subtotal,
      discountPct: contracts.discountPct,
      discountAmount: contracts.discountAmount,
      total: contracts.taxableBase,
      totalCost: contracts.totalCost,
      totalMargin: contracts.totalMargin,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
    .for('update');
  if (!row) fail('record_not_found');
  if (row.sourceBoqId === null) fail('contract_not_execution');
  if (row.status !== 'draft') fail('contract_not_draft');
  return row;
}

/**
 * Set VAT and supervision on a DRAFT execution contract. A proposal contract is
 * `contract_not_execution`; an issued one `contract_not_draft` (also the answer
 * when an issue wins the row first, MT100). An amount-based schedule set
 * against the old value no longer adds up afterwards: the issue gate refuses it
 * (`contract_schedule_invalid`) until the schedule is saved again.
 */
export async function setContractChargesCore(
  ctx: OrgContext,
  input: SetContractChargesInput,
): Promise<ActionResult> {
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  if (!isUuid(contractId)) return err('malformed');
  const rates = readContractCharges(input);
  if (!rates.ok) return fieldsFailed(rates.errors);

  return mutateInOrg(
    ctx,
    { capability: 'contracts_generate', action: 'update', immutableCode: 'contract_not_draft' },
    async (tx, audit) => {
      const contract = await lockDraftExecutionContract(tx, contractId);
      const totals = contractTotalsFromBoq(contract, rates.values);
      await tx
        .update(contracts)
        .set({
          taxRate: totals.taxRate,
          taxAmount: totals.taxAmount,
          supervisionPct: totals.supervisionPct,
          supervisionAmount: totals.supervisionAmount,
          originalValue: totals.originalValue,
          updatedAt: new Date(),
        })
        .where(and(eq(contracts.id, contractId), eq(contracts.status, 'draft')));
      await audit({
        entity: 'contract',
        entityId: contractId,
        action: 'update',
        before: null,
        after: { charges: rates.values },
      });
    },
  );
}
