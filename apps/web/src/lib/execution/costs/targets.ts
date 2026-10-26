import 'server-only';
// What the cost entry cores (./core.ts) read inside their RLS transaction
// before they write, each a coded refusal when the answer forbids the write:
// the contract an entry is booked on, the line and section it is booked to,
// the price-book item it names, and the entry an edit or a void changes.
//
// NO CONTRACT-LEVEL LOCK, on purpose (the lock-order addendum applies to cores
// that write contract children AND the contract row; these write neither). A
// contract never returns to `draft`, and a non-draft contract's sections and
// lines are frozen (MT100), so a status or a target read here cannot change
// under the write. The insert's foreign keys take only KEY SHARE on the
// contract, section and line rows, which no contract writer conflicts with.
import { contractCostEntries, contractLines, contractSections, contracts, costItems, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { failFields } from '@/lib/actions/field-errors';
import { fail } from '@/lib/actions/mutate';
import type { OrgContext } from '@/lib/db/context';
import { mayChangeCostEntry } from './access';
import type { CleanCostEntry } from './input';

/** The contract a cost may be booked on: an execution contract (from a BOQ) that has left `draft` (A15). */
export async function requireCostableContract(tx: MetraDb, contractId: string): Promise<void> {
  const [contract] = await tx
    .select({ status: contracts.status, sourceBoqId: contracts.sourceBoqId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract) fail('record_not_found');
  if (contract.sourceBoqId === null) fail('contract_not_execution');
  if (contract.status === 'draft') fail('contract_not_issued');
}

/**
 * The section, the line and the price-book item the entry names, each of THIS
 * contract (and studio). The 3-column foreign keys make a line and a section
 * belong to the contract; that the line sits in the NAMED section is this
 * check alone (lead ruling on PR A2), answered `line_not_in_contract`.
 */
export async function requireTargets(tx: MetraDb, contractId: string, entry: CleanCostEntry): Promise<void> {
  if (entry.contractSectionId !== null) {
    const [section] = await tx
      .select({ id: contractSections.id })
      .from(contractSections)
      .where(and(eq(contractSections.id, entry.contractSectionId), eq(contractSections.contractId, contractId)))
      .limit(1);
    if (!section) failFields({ contractSectionId: { code: 'no_longer_exists' } });
  }
  if (entry.contractLineId !== null && entry.contractSectionId !== null) {
    const [line] = await tx
      .select({ id: contractLines.id })
      .from(contractLines)
      .where(
        and(
          eq(contractLines.id, entry.contractLineId),
          eq(contractLines.contractId, contractId),
          eq(contractLines.sectionId, entry.contractSectionId),
        ),
      )
      .limit(1);
    if (!line) fail('line_not_in_contract');
  }
  if (entry.costItemId !== null) {
    const [item] = await tx.select({ id: costItems.id }).from(costItems).where(eq(costItems.id, entry.costItemId)).limit(1);
    if (!item) failFields({ costItemId: { code: 'no_longer_exists' } });
  }
}

/** The columns an entry writes, as the edit's audit records them. */
const COST_ENTRY_COLUMNS = {
  contractId: contractCostEntries.contractId,
  category: contractCostEntries.category,
  description: contractCostEntries.description,
  amount: contractCostEntries.amount,
  incurredOn: contractCostEntries.incurredOn,
  contractSectionId: contractCostEntries.contractSectionId,
  contractLineId: contractCostEntries.contractLineId,
  qty: contractCostEntries.qty,
  unit: contractCostEntries.unit,
  unitCost: contractCostEntries.unitCost,
  supplier: contractCostEntries.supplier,
  reference: contractCostEntries.reference,
  costItemId: contractCostEntries.costItemId,
  voidedAt: contractCostEntries.voidedAt,
};

/**
 * The entry an edit or a void changes, locked FOR UPDATE so a void racing the
 * edit (or another void) waits for it, and the one that waits then sees the
 * entry voided. Refused in this order: not this studio's or no such entry,
 * not this member's to change (lead ruling on PR B3: owner and admin change
 * any entry, every other role only the ones it recorded), already voided.
 */
export async function lockLiveEntry(tx: MetraDb, ctx: OrgContext, entryId: string) {
  const [entry] = await tx
    .select({ ...COST_ENTRY_COLUMNS, recordedBy: contractCostEntries.recordedBy })
    .from(contractCostEntries)
    .where(eq(contractCostEntries.id, entryId))
    .limit(1)
    .for('update');
  if (!entry) fail('cost_entry_not_found');
  if (!mayChangeCostEntry(ctx.role, entry, ctx.userId)) fail('forbidden');
  if (entry.voidedAt !== null) fail('cost_entry_voided');
  return entry;
}
