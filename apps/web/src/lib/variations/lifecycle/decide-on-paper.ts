// issued -> approved | rejected, recorded by the studio: the client decided the
// change order on paper (H7.3). While a client cannot receive a code (ruling
// OD2, strict), this is the only way a decision made outside Metra lands. The
// other way is the client's own decision with a code (app_variation_respond_by_token).
//
// The order row is frozen once it leaves draft, and a pure status flip is what
// enforce_variation_order_frozen admits, so the row records nothing but the
// flip. The event carries the rest: kind approved or rejected, channel 'staff',
// `recorded_on_paper` (so no reader takes a paper refusal for the termination
// cascade), who recorded it as `actor_user_id`, and the day the client decided
// as `decided_at` (midnight of that day in Cairo). The note goes to the audit
// log, as a paper signature's does.
import { variationOrderEvents, variationOrders, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { ENDING_DECIDERS } from '@/lib/engagements/transitions/trigger-roles';
import { holdContract } from '@/lib/execution/final-account/gate';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { dayBeforeIssue } from '@/lib/validation/day-field';
import { readPaperDecision, type TypedPaperDecision } from '../decide-on-paper-input';
import { isContractActive } from '../lifecycle-rules';
import { variationIssuedOnInCairo } from '../queries/issued-on';

export interface RecordVariationDecisionOnPaperInput extends TypedPaperDecision {
  variationOrderId?: unknown;
}

type PaperOutcome = 'approved' | 'rejected';

/** Owner, admin or project manager: who stands in for the client's decision, as for a paper signature. */
export function mayRecordVariationDecisionOnPaper(role: OrgContext['role']): boolean {
  return ENDING_DECIDERS.includes(role);
}

/**
 * The flip, under the locks the client's own decision takes, in its order: the
 * contract FOR SHARE (a termination holds it FOR UPDATE), then the order FOR
 * UPDATE. A client deciding at the same moment meets this on the order row:
 * whichever commits first wins, and the other reads the order decided (here
 * `variation_not_issued`, online `already`). The status in the UPDATE's WHERE
 * is the admission gate. A day before the order was issued is refused under its
 * box: the evidence never says the client decided an order not yet sent.
 */
async function decideIssuedVariation(
  tx: MetraDb,
  variationOrderId: string,
  outcome: PaperOutcome,
  decidedOn: string,
): Promise<void> {
  const { contractId } = await requireInOrg(
    tx,
    variationOrders,
    variationOrderId,
    { contractId: variationOrders.contractId },
    'record_not_found',
  );
  const contract = await holdContract(tx, contractId);
  if (!isContractActive(contract.status)) fail('contract_not_active');
  const [locked] = await tx
    .select({ status: variationOrders.status })
    .from(variationOrders)
    .where(eq(variationOrders.id, variationOrderId))
    .limit(1)
    .for('update');
  // A draft may be deleted between the two reads; nothing else ever is.
  if (!locked) fail('record_not_found');
  if (locked.status !== 'issued') fail('variation_not_issued');
  const beforeIssue = dayBeforeIssue(decidedOn, await variationIssuedOnInCairo(tx, variationOrderId));
  if (beforeIssue) failFields({ decidedOn: beforeIssue });
  const flipped = await tx
    .update(variationOrders)
    .set({ status: outcome, updatedAt: new Date() })
    .where(and(eq(variationOrders.id, variationOrderId), eq(variationOrders.status, 'issued')))
    .returning({ id: variationOrders.id });
  if (!flipped[0]) fail('variation_not_issued');
}

/**
 * Record that the client approved or rejected an ISSUED change order on paper,
 * on `decidedOn` (not after today, not before the issue day, in Cairo). An
 * order in any other status is `variation_not_issued`; one whose contract is
 * no longer live `contract_not_active`; any role but owner, admin or project
 * manager `forbidden`. An approval is billable exactly as an online one.
 */
export async function recordVariationDecisionOnPaperCore(
  ctx: OrgContext,
  input: RecordVariationDecisionOnPaperInput,
): Promise<ActionResult> {
  if (!mayRecordVariationDecisionOnPaper(ctx.role)) return err('forbidden');
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const variationOrderId = typeof input.variationOrderId === 'string' ? input.variationOrderId.trim() : '';
  if (!isUuid(variationOrderId)) return err('malformed');
  const read = readPaperDecision(input, todayInCairo(new Date()));
  if (!read.ok) return fieldsFailed(read.errors);
  const { decision, decidedOn, note } = read.values;
  const outcome: PaperOutcome = decision === 'approve' ? 'approved' : 'rejected';

  return mutateInOrg(ctx, { immutableCode: 'variation_not_issued', capTransaction: true }, async (tx, audit) => {
    await decideIssuedVariation(tx, variationOrderId, outcome, decidedOn);
    await tx.insert(variationOrderEvents).values({
      orgId: ctx.orgId,
      variationOrderId,
      kind: outcome,
      actorChannel: 'staff',
      recordedOnPaper: true,
      actorUserId: ctx.userId,
      fromStatus: 'issued',
      toStatus: outcome,
      decidedAt: sql`(${decidedOn}::date)::timestamp at time zone 'Africa/Cairo'`,
    });
    await audit({
      entity: 'variation_order',
      entityId: variationOrderId,
      action: 'update',
      before: { status: 'issued' },
      after: { status: outcome, decided_on: decidedOn, decided_on_paper: true, note },
    });
  });
}
