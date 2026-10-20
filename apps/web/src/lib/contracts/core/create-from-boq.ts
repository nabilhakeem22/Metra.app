// Execution contract generation: generateExecutionContractCore. Deep-copies an
// ISSUED BOQ's sections and lines into a new DRAFT contract and adds VAT and the
// supervision fee on top of the BOQ total, which is carried to the piastre and
// never recomputed (plan A4).
//
// Five named phases inside the one `mutateInOrg`: load the BOQ (locked, so a
// re-issue cannot supersede it under this transaction), check its delivery,
// persist the header, lock it, copy the content (./create-from-boq-copy.ts).
import { boqs, contracts, designEngagements, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { contractTotalsFromBoq } from '@/lib/execution/money/charges';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { readContractCharges, type ContractChargeRates, type ContractChargesInput } from '../charges-input';
import { copyBoqContentToContract } from './create-from-boq-copy';

export interface GenerateExecutionContractInput extends ContractChargesInput {
  boqId?: unknown;
}

/** One execution contract per BOQ (0063): losing that race is `contract_exists`. */
export const CONTRACT_PER_BOQ_CONSTRAINT = 'contracts_org_id_source_boq_unique';

type IssuedBoq = Pick<
  typeof boqs.$inferSelect,
  | 'id' | 'status' | 'titleAr' | 'titleEn' | 'clientId' | 'projectId' | 'engagementId' | 'currency'
  | 'subtotal' | 'discountPct' | 'discountAmount' | 'total' | 'totalCost' | 'totalMargin'
>;

/**
 * The BOQ, read FOR SHARE: a concurrent issue of a newer version locks it FOR
 * UPDATE to supersede it (lib/boqs/issue/freeze.ts), so the two serialize and
 * the supersede then sees this contract and refuses `boq_has_contract`.
 */
async function loadIssuedBoq(tx: MetraDb, boqId: string): Promise<IssuedBoq> {
  const [boq] = await tx
    .select({
      id: boqs.id, status: boqs.status, titleAr: boqs.titleAr, titleEn: boqs.titleEn,
      clientId: boqs.clientId, projectId: boqs.projectId, engagementId: boqs.engagementId,
      currency: boqs.currency, subtotal: boqs.subtotal, discountPct: boqs.discountPct,
      discountAmount: boqs.discountAmount, total: boqs.total, totalCost: boqs.totalCost,
      totalMargin: boqs.totalMargin,
    })
    .from(boqs)
    .where(eq(boqs.id, boqId))
    .limit(1)
    .for('share');
  if (!boq) fail('boq_not_found');
  if (boq.status !== 'issued') fail('boq_not_issued');
  return boq;
}

/** A BOQ on a delivery waits for the delivery to choose execution (plan A2).
 *  A BOQ with no delivery behind it (an execution-only project) needs nothing. */
async function requireDeliveryInExecution(tx: MetraDb, engagementId: string | null): Promise<void> {
  if (engagementId === null) return;
  const [delivery] = await tx
    .select({ state: designEngagements.state })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .limit(1);
  if (delivery?.state !== 'execution') fail('delivery_not_in_execution');
}

/** The fast path of "one contract per BOQ"; the unique index is the real guard. */
async function refuseSecondContract(tx: MetraDb, boqId: string): Promise<void> {
  const [existing] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.sourceBoqId, boqId))
    .limit(1);
  if (existing) fail('contract_exists');
}

/** Insert the draft header and return its id. Retention and advance stay 0 (plan A5). */
async function persistExecutionHeader(
  tx: MetraDb,
  ctx: OrgContext,
  boq: IssuedBoq,
  rates: ContractChargeRates,
): Promise<{ id: string; number: number }> {
  const number = await allocateNumber(tx, ctx.orgId, 'contracts', 'contracts', 'number');
  const [row] = await tx
    .insert(contracts)
    .values({
      orgId: ctx.orgId,
      number,
      titleAr: boq.titleAr,
      titleEn: boq.titleEn,
      sourceBoqId: boq.id,
      clientId: boq.clientId,
      projectId: boq.projectId,
      currency: boq.currency,
      ...contractTotalsFromBoq(boq, rates),
    })
    .returning({ id: contracts.id });
  // The lock-order rule (plan addendum, Oct 20): a core that writes contract
  // children holds the contract FOR UPDATE before the first child write. The row
  // is new and invisible to everyone else, so this costs nothing and keeps the
  // rule without exceptions.
  await tx.execute(sql`select 1 from public.contracts where id = ${row.id} for update`);
  return { id: row.id, number };
}

/**
 * Generate a DRAFT execution contract from an ISSUED BOQ. One contract per BOQ
 * (`contract_exists`); a draft or superseded BOQ is `boq_not_issued`; a BOQ on
 * a delivery that has not chosen execution is `delivery_not_in_execution`;
 * another org's BOQ is `boq_not_found` (RLS hides it).
 */
export async function generateExecutionContractCore(
  ctx: OrgContext,
  input: GenerateExecutionContractInput,
): Promise<ActionResult & { data?: string }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const boqId = typeof input.boqId === 'string' ? input.boqId.trim() : '';
  if (!isUuid(boqId)) return err('malformed');
  const rates = readContractCharges(input);
  if (!rates.ok) return fieldsFailed(rates.errors);

  return mutateInOrg(
    ctx,
    {
      capability: 'contracts_generate',
      action: 'create',
      refusals: [{ constraint: CONTRACT_PER_BOQ_CONSTRAINT, code: 'contract_exists' }],
    },
    async (tx, audit) => {
      const boq = await loadIssuedBoq(tx, boqId);
      await requireDeliveryInExecution(tx, boq.engagementId);
      await refuseSecondContract(tx, boqId);
      const contract = await persistExecutionHeader(tx, ctx, boq, rates.values);
      await copyBoqContentToContract(tx, { orgId: ctx.orgId, boqId, contractId: contract.id });
      await audit({
        entity: 'contract',
        entityId: contract.id,
        action: 'create',
        before: null,
        after: { number: contract.number, source_boq_id: boqId, ...rates.values },
      });
      return contract.id;
    },
  );
}
