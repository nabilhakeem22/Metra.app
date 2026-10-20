// The Schedule tab's save: saveContractScheduleCore. Replaces a DRAFT execution
// contract's whole payment schedule in one transaction. The schedule is part of
// what the client signs, so it is frozen once the contract is issued, by the
// database (`enforce_contract_child_draft()`, MT100) as well as here.
import { contractPaymentMilestones, contracts, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { validateSchedule, type CleanScheduleRow } from '@/lib/execution/money/schedule';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { readScheduleRows } from './input';

export interface SaveContractScheduleInput {
  contractId?: unknown;
  milestones?: unknown;
}

/**
 * The contract row FOR UPDATE, FIRST (plan A3.2 addendum and the lock-order
 * rule): a save racing an issue then waits for it and finds `issued`, and the
 * issue gate never reads a schedule a save still holds open.
 */
async function lockDraftExecutionContract(tx: MetraDb, contractId: string) {
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
  if (row.sourceBoqId === null) fail('contract_not_execution');
  if (row.status !== 'draft') fail('contract_not_draft');
  return row;
}

async function replaceSchedule(
  tx: MetraDb,
  ctx: OrgContext,
  contractId: string,
  rows: CleanScheduleRow[],
): Promise<void> {
  await tx.delete(contractPaymentMilestones).where(eq(contractPaymentMilestones.contractId, contractId));
  await tx.insert(contractPaymentMilestones).values(
    rows.map((row) => ({
      orgId: ctx.orgId,
      contractId,
      labelAr: row.labelAr,
      labelEn: row.labelEn,
      basis: row.basis,
      value: row.value,
      sortOrder: row.sortOrder,
    })),
  );
}

/**
 * Replace the schedule of a DRAFT execution contract: 1 to 12 rows of one
 * basis that add up (lib/execution/money/schedule.ts). Every refusal of a row
 * sits under its box; one of the schedule as a whole under `milestones`.
 */
export async function saveContractScheduleCore(
  ctx: OrgContext,
  input: SaveContractScheduleInput,
): Promise<ActionResult> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  if (!isUuid(contractId)) return err('malformed');
  const read = readScheduleRows(input.milestones);
  if (!read.ok) return fieldsFailed(read.errors);

  return mutateInOrg(
    ctx,
    { capability: 'contracts_generate', action: 'update', immutableCode: 'contract_not_draft' },
    async (tx, audit) => {
      const contract = await lockDraftExecutionContract(tx, contractId);
      // Validated against the value it is locked at: the sum check needs it.
      const schedule = validateSchedule(read.rows, contract.originalValue, contract.taxAmount);
      if (!schedule.ok) failFields(schedule.errors);
      await replaceSchedule(tx, ctx, contractId, schedule.rows);
      await audit({
        entity: 'contract',
        entityId: contractId,
        action: 'update',
        before: null,
        after: { schedule: { rows: schedule.rows.length, basis: schedule.rows[0].basis } },
      });
    },
  );
}
