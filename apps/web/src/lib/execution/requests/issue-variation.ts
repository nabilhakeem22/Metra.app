// issueVariationRequestCore: the studio sends the payment request (مطالبة دفع)
// for one APPROVED change order of a signed execution contract (plan A4.1, A11).
//
// It bills `variationCharge`: works = the order's net delta, VAT at the
// contract's rate, and the supervision fee at the contract's rate (decision
// D4a), itself untaxed. Only an order that ADDS money is billed on its own; a
// de-scope lowers the final account instead (`variation_credit_not_billable`).
// One live request per order (`payment_requests_one_per_variation`); nothing is
// billed once the final account is issued.
import { variationOrders } from '@metra/db';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { isUuid } from '@/lib/uuid';
import { isVariationBillable, variationCharge } from '../money/variation-charge';
import { loadContractMoneyFacts } from '../queries/money-facts';
import { insertPaymentRequest } from './append';
import { lockBillableContract } from './billing-lock';
import { readRequestTerms, type TypedRequestTerms } from './input';

export interface IssueVariationRequestInput extends TypedRequestTerms {
  variationOrderId?: unknown;
}

export async function issueVariationRequestCore(
  ctx: OrgContext,
  input: IssueVariationRequestInput,
): Promise<ActionResult & { data?: string }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const variationOrderId = typeof input.variationOrderId === 'string' ? input.variationOrderId.trim() : '';
  if (!isUuid(variationOrderId)) return err('malformed');
  const issuedOn = todayInCairo(new Date());
  const read = readRequestTerms(input, issuedOn);
  if (!read.ok) return fieldsFailed(read.errors);

  return mutateInOrg(
    ctx,
    {
      capability: 'invoices_issue',
      action: 'approve',
      capTransaction: true,
      refusals: [{ constraint: 'payment_requests_one_per_variation', code: 'request_exists' }],
    },
    async (tx, audit) => {
      // Read before the contract lock: `approved` is final, so a status read
      // here cannot be overtaken into something billable that was not.
      const order = await requireInOrg(
        tx,
        variationOrders,
        variationOrderId,
        { contractId: variationOrders.contractId, status: variationOrders.status, netDelta: variationOrders.netDelta },
        'record_not_found',
      );
      const contract = await lockBillableContract(tx, order.contractId);
      if ((await loadContractMoneyFacts(tx, contract.id)).finalAccount) fail('final_account_issued');
      if (order.status !== 'approved') fail('variation_not_approved');
      if (!isVariationBillable(order.netDelta)) fail('variation_credit_not_billable');
      const charge = variationCharge(order.netDelta, contract.taxRate, contract.supervisionPct);
      return insertPaymentRequest(tx, ctx, audit, {
        contractId: contract.id,
        kind: 'variation',
        milestoneId: null,
        variationOrderId,
        amount: charge.total,
        taxAmount: charge.tax,
        issuedOn,
        ...read.values,
      });
    },
  );
}
