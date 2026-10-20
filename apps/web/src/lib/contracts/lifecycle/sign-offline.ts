// issued -> signed, recorded by the studio: the client signed the contract on
// paper (owner decision D5). The other way to `signed` is the client's own
// electronic acknowledgement on /c (app_contract_ack_by_token).
//
// The contract row is status-locked once issued, and `issued -> signed` is the
// one whitelisted change, so the row records nothing but the flip. The day the
// client signed is the event's `decided_at` (midnight of that day in Cairo); who
// recorded it is its `actor_user_id`; the note goes to the audit log.
import { contractEvents, contracts, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { ENDING_DECIDERS } from '@/lib/engagements/transitions/trigger-roles';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { readOfflineSignature, type TypedOfflineSignature } from '../sign-offline-input';

export interface RecordContractSignedOfflineInput extends TypedOfflineSignature {
  contractId?: unknown;
}

/** Owner, admin or project manager: who stands in for the client's consent (D5). */
export function mayRecordSignedOffline(role: OrgContext['role']): boolean {
  return ENDING_DECIDERS.includes(role);
}

/**
 * The day the contract was issued, in Cairo: the day of its `issued` event, or
 * of the contract itself for one issued before events were kept.
 */
async function issuedOnInCairo(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    select to_char(coalesce((
             select min(e.decided_at) from public.contract_events e
              where e.contract_id = c.id and e.kind = 'issued'
           ), c.created_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
      from public.contracts c
     where c.id = ${contractId}
  `)) as unknown as Array<{ day: string }>;
  return rows[0].day;
}

/**
 * Flip issued -> signed under the row lock; the status in the WHERE is the
 * admission gate. A paper signature dated before the contract was issued is
 * refused under its box (`date_before_issue`, with the issue day): the
 * evidence record never says the client signed a contract that did not exist.
 */
async function signIssuedContract(tx: MetraDb, contractId: string, signedOn: string): Promise<void> {
  const [locked] = await tx
    .select({ status: contracts.status, sourceBoqId: contracts.sourceBoqId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1)
    .for('update');
  if (!locked) fail('record_not_found');
  if (locked.sourceBoqId === null) fail('contract_not_execution');
  if (locked.status !== 'issued') fail('contract_not_signable');
  const issuedOn = await issuedOnInCairo(tx, contractId);
  if (signedOn < issuedOn) failFields({ signedOn: { code: 'date_before_issue', params: { date: issuedOn } } });
  const flipped = await tx
    .update(contracts)
    .set({ status: 'signed', updatedAt: new Date() })
    .where(and(eq(contracts.id, contractId), eq(contracts.status, 'issued')))
    .returning({ id: contracts.id });
  if (!flipped[0]) fail('contract_not_signable');
}

/**
 * Record that the client signed an ISSUED execution contract on paper, on
 * `signedOn` (not after today, not before the issue day, in Cairo). A draft,
 * signed or terminated contract is `contract_not_signable`;
 * a proposal contract `contract_not_execution`; any role but owner, admin or
 * project manager `forbidden`.
 */
export async function recordContractSignedOfflineCore(
  ctx: OrgContext,
  input: RecordContractSignedOfflineInput,
): Promise<ActionResult> {
  if (!mayRecordSignedOffline(ctx.role)) return err('forbidden');
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  if (!isUuid(contractId)) return err('malformed');
  const read = readOfflineSignature(input, todayInCairo(new Date()));
  if (!read.ok) return fieldsFailed(read.errors);
  const { signedOn, note } = read.values;

  return mutateInOrg(ctx, { immutableCode: 'contract_not_signable' }, async (tx, audit) => {
    await signIssuedContract(tx, contractId, signedOn);
    await tx.insert(contractEvents).values({
      orgId: ctx.orgId,
      contractId,
      kind: 'acknowledged_offline',
      actorUserId: ctx.userId,
      fromStatus: 'issued',
      toStatus: 'signed',
      decidedAt: sql`(${signedOn}::date)::timestamp at time zone 'Africa/Cairo'`,
    });
    await audit({
      entity: 'contract',
      entityId: contractId,
      action: 'update',
      before: { status: 'issued' },
      after: { status: 'signed', signed_on: signedOn, signed_offline: true, note },
    });
  });
}
