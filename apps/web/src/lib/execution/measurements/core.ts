// recordMeasurementCore: the site engineer or the PM records the FINAL
// MEASURED QUANTITY of one line of a signed execution contract, at handover
// (plan A5.1, owner decision Oct 19). The ledger is append-only: a correction
// is a new reading, and the latest recorded one (highest `seq`) is the line's.
// Only a provisional line bills its difference in the final account (D2a); a
// firm line's difference is flagged there as needing a change order.
//
// Refused: a line that is not this contract's (`line_not_in_contract`, the
// 3-column FK is the database's backstop), a contract not yet signed or
// terminated, a final account already issued (`final_account_issued`, until
// it is voided), and a day before the contract was issued (under the day).
//
// LOCKS: the contract FOR SHARE first (../final-account/gate.ts), so a final
// account and a measurement never pass each other.
//
// IDEMPOTENT: the key is required, and lower-cased. A key the contract already
// holds is judged before the final account: the same line, quantity and day
// answer that reading with `already: true` (a retry after a lost answer);
// anything else is `idempotency_conflict`.
import { contractLines, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import { contractIssuedOnInCairo } from '@/lib/contracts/queries/issued-on';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { dayBeforeIssue } from '@/lib/validation/day-field';
import { holdContract, isFinalAccountIssued } from '../final-account/gate';
import { canonicalIdempotencyKey } from '../idempotency-key';
import { readMeasurement, type TypedMeasurement } from './input';
import { appendKeyedMeasurement, findKeyedMeasurement, isSameMeasurement, type KeyedMeasurement } from './ledger';

export interface RecordMeasurementInput extends TypedMeasurement {
  contractId?: unknown;
  contractLineId?: unknown;
  idempotencyKey?: unknown;
}

const idOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

async function refuseLineOutsideContract(tx: MetraDb, contractId: string, contractLineId: string): Promise<void> {
  const [line] = await tx
    .select({ id: contractLines.id })
    .from(contractLines)
    .where(and(eq(contractLines.id, contractLineId), eq(contractLines.contractId, contractId)))
    .limit(1);
  if (!line) fail('line_not_in_contract');
}

export async function recordMeasurementCore(
  ctx: OrgContext,
  input: RecordMeasurementInput,
): Promise<ActionResult & { data?: string; already?: boolean }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const contractId = idOf(input.contractId);
  const contractLineId = idOf(input.contractLineId);
  const idempotencyKey = canonicalIdempotencyKey(input.idempotencyKey);
  if (!isUuid(contractId) || !isUuid(contractLineId) || !isUuid(idempotencyKey)) return err('malformed');
  const read = readMeasurement(input, todayInCairo(new Date()));
  if (!read.ok) return fieldsFailed(read.errors);
  const attempt = { contractLineId, ...read.values };

  // Set inside the transaction; the assertion keeps TypeScript from narrowing it to false.
  let already = false as boolean;
  /** The stored reading's id when it IS this reading; a different one under the key is refused. */
  const replayed = (stored: KeyedMeasurement) => {
    if (!isSameMeasurement(stored, attempt)) fail('idempotency_conflict');
    already = true;
    return stored.id;
  };
  const result = await mutateInOrg(ctx, { capability: 'site_measurements', action: 'create' }, async (tx, audit) => {
    const contract = await holdContract(tx, contractId);
    if (contract.sourceBoqId === null) fail('contract_not_execution');
    if (contract.status === 'terminated') fail('contract_not_active');
    if (contract.status !== 'signed') fail('contract_not_signed');
    const stored = await findKeyedMeasurement(tx, contractId, idempotencyKey);
    if (stored !== null) return replayed(stored);
    if (await isFinalAccountIssued(tx, contractId)) fail('final_account_issued');
    await refuseLineOutsideContract(tx, contractId, contractLineId);
    const beforeIssue = dayBeforeIssue(read.values.measuredOn, await contractIssuedOnInCairo(tx, contractId));
    if (beforeIssue) failFields({ measuredOn: beforeIssue });
    const appended = await appendKeyedMeasurement(tx, ctx, { contractId, contractLineId }, read.values, idempotencyKey);
    if ('replayed' in appended) return replayed(appended.replayed);
    await audit({
      entity: 'contract_line_measurement',
      entityId: appended.inserted,
      action: 'create',
      before: null,
      after: { contract_line_id: contractLineId, measured_qty: read.values.measuredQty, measured_on: read.values.measuredOn },
    });
    return appended.inserted;
  });
  return result.ok ? { ...result, already } : result;
}
