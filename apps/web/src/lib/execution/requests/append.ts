import 'server-only';
// The one way a payment request (مطالبة دفع) reaches its table: the next number
// of the studio's PR sequence (allocateNumber's per-org advisory lock; a void
// keeps its number, so a number is never reused), then the frozen row, then
// its audit entry. Nothing here decides anything: the issue cores have locked
// the contract and refused whatever cannot be billed. The caller's `tx` is
// used and nothing else.
import { paymentRequests, type MetraDb, type PaymentRequestKind } from '@metra/db';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { allocateNumber } from '@/lib/db/allocate-number';

export interface NewPaymentRequest {
  contractId: string;
  kind: PaymentRequestKind;
  milestoneId: string | null;
  variationOrderId: string | null;
  /** VAT included, scale-4. */
  amount: string;
  taxAmount: string;
  /** Today in Cairo: the day the due date was checked against. */
  issuedOn: string;
  dueOn: string | null;
  note: string | null;
}

export async function insertPaymentRequest(
  tx: MetraDb,
  ctx: OrgContext,
  audit: (entry: AuditEntry) => Promise<void>,
  request: NewPaymentRequest,
): Promise<string> {
  const number = await allocateNumber(tx, ctx.orgId, 'payment_requests', 'payment_requests', 'number');
  const [row] = await tx
    .insert(paymentRequests)
    .values({ orgId: ctx.orgId, number, issuedBy: ctx.userId, ...request })
    .returning({ id: paymentRequests.id });
  await audit({
    entity: 'payment_request',
    entityId: row.id,
    action: 'issue',
    before: null,
    after: {
      contract_id: request.contractId,
      number,
      kind: request.kind,
      amount: request.amount,
      tax_amount: request.taxAmount,
      due_on: request.dueOn,
    },
  });
  return row.id;
}
