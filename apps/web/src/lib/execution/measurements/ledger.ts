import 'server-only';
// The one way a reading reaches the append-only measurement ledger, keyed.
// Nothing here decides anything: the core has held the contract and refused
// what cannot be recorded, and it judges a replayed key. The caller's `tx` is
// used and nothing else. ON CONFLICT DO NOTHING on the partial arbiter (the
// payment ledger's shape, payments/append.ts), so a replay never aborts the
// transaction and never writes a second reading; the reading that holds the
// key comes back for the core to judge.
import { contractLineMeasurements, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import type { CleanMeasurement } from './input';

export interface KeyedMeasurement {
  id: string;
  contractLineId: string;
  measuredQty: string;
  measuredOn: string;
}

/** The key names ONE reading: this line, this quantity, this day. */
export function isSameMeasurement(stored: KeyedMeasurement, attempt: { contractLineId: string } & CleanMeasurement): boolean {
  return (
    stored.contractLineId === attempt.contractLineId &&
    parseMoney4(stored.measuredQty) === parseMoney4(attempt.measuredQty) &&
    stored.measuredOn === attempt.measuredOn
  );
}

/** The reading this key already recorded on the contract, or null. */
export async function findKeyedMeasurement(tx: MetraDb, contractId: string, idempotencyKey: string): Promise<KeyedMeasurement | null> {
  const [row] = await tx
    .select({
      id: contractLineMeasurements.id,
      contractLineId: contractLineMeasurements.contractLineId,
      measuredQty: contractLineMeasurements.measuredQty,
      measuredOn: contractLineMeasurements.measuredOn,
    })
    .from(contractLineMeasurements)
    .where(and(eq(contractLineMeasurements.contractId, contractId), eq(contractLineMeasurements.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row ?? null;
}

/** The new reading's id, or the reading a concurrent write of the same key committed first. */
export async function appendKeyedMeasurement(
  tx: MetraDb,
  ctx: OrgContext,
  target: { contractId: string; contractLineId: string },
  reading: CleanMeasurement,
  idempotencyKey: string,
): Promise<{ inserted: string } | { replayed: KeyedMeasurement }> {
  // Written out, not through drizzle's insert: drizzle names EVERY column, `seq`
  // included (as DEFAULT), and metra_app has no INSERT on `seq` by design
  // (roles.sql, security review S1: a writer must not pick the recording order).
  // The arbiter is `contract_line_measurements_idempotency_key_uniq`.
  const inserted = (await tx.execute(sql`
    insert into public.contract_line_measurements
      (org_id, contract_id, contract_line_id, measured_qty, measured_on, note, recorded_by, idempotency_key)
    values (${ctx.orgId}, ${target.contractId}, ${target.contractLineId}, ${reading.measuredQty}, ${reading.measuredOn},
            ${reading.note}, ${ctx.userId}, ${idempotencyKey})
    on conflict (org_id, contract_id, idempotency_key) where idempotency_key is not null do nothing
    returning id
  `)) as unknown as Array<{ id: string }>;
  if (inserted.length > 0) return { inserted: inserted[0].id };
  const existing = await findKeyedMeasurement(tx, target.contractId, idempotencyKey);
  if (existing === null) throw new Error('appendKeyedMeasurement: conflict without a row');
  return { replayed: existing };
}
