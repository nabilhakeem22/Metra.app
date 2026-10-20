// issueFinalAccountCore: the studio issues the final account (الحساب الختامي)
// of a signed execution contract as its last payment request (plan A5.2, A14):
// the contract, plus approved change orders, plus the measured differences of
// the provisional lines (D2a), minus every request issued so far.
//
// Refused: a change order still awaiting a decision (`open_variations`), a
// balance of zero or less (`final_account_nothing_due`, whatever figure was
// shown, a negative one included: F9), a balance past the money cap
// (`final_account_too_large`: a mistyped reading on a provisional line, S3),
// a balance that is not the one the studio was shown (`final_account_changed`,
// with the balance now: a measurement, an approval or a payment request moved
// it), and a final account already issued (`request_exists`; the partial
// unique `payment_requests_one_final_account` is the database's backstop). Once
// issued it closes new requests, measurements and change-order approvals,
// until it is voided (unpaid only, requests/void.ts).
//
// LOCKS: the contract FOR UPDATE FIRST, like every request writer (A4 coder's
// note, requests/billing-lock.ts). Measurements and approvals hold it FOR
// SHARE first (./gate.ts), so the figures read here cannot move under it. The
// writer is capped (`capTransaction`, A5 R1): a steady stream of those share
// holders can delay it, never hold it past about 7 s.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { fieldsFailed } from '@/lib/actions/field-errors';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { isRecord } from '@/lib/guards/is-record';
import { readMoney, withinMagnitude } from '@/lib/money/read';
import { isUuid } from '@/lib/uuid';
import { finalAccountFigures } from '../money/final-account';
import { finalAccountTax } from '../money/final-account-tax';
import { loadMeasuredWorks } from '../queries/measured-works';
import { loadContractMoneyFacts } from '../queries/money-facts';
import { insertPaymentRequest } from '../requests/append';
import { lockBillableContract } from '../requests/billing-lock';
import { readRequestTerms, type TypedRequestTerms } from '../requests/input';

export interface IssueFinalAccountInput extends TypedRequestTerms {
  contractId?: unknown;
  /** The balance the studio was shown (scale-4): the request bills only that. */
  expectedAmount?: unknown;
}

/** A shown balance past the money cap: well formed, but no balance that may be issued equals it. */
const OVER_CAP = 'over_cap';

/**
 * The balance the studio was shown, with its sign (a negative one is what the
 * card shows on a contract billed past its final value), or null when it is
 * not a figure at all.
 */
function readShownBalance(raw: unknown): string | typeof OVER_CAP | null {
  const read = readMoney(typeof raw === 'string' ? raw : null, { allowNegative: true });
  if (read.ok) return read.value;
  return read.reason === 'too_large' ? OVER_CAP : null;
}

/** Σ VAT of the issued requests. */
async function issuedRequestsTax(tx: MetraDb, contractId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(r.tax_amount), 0)::text as tax
      from public.payment_requests r where r.contract_id = ${contractId} and r.status = 'issued'
  `)) as unknown as Array<{ tax: string }>;
  return rows[0].tax;
}

export async function issueFinalAccountCore(
  ctx: OrgContext,
  input: IssueFinalAccountInput,
): Promise<ActionResult & { data?: string }> {
  // Directly invokable: a null or a non-object payload is malformed, never a throw.
  if (!isRecord(input)) return err('malformed');
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  const shown = readShownBalance(input.expectedAmount);
  if (!isUuid(contractId) || shown === null) return err('malformed');
  const issuedOn = todayInCairo(new Date());
  const read = readRequestTerms(input, issuedOn);
  if (!read.ok) return fieldsFailed(read.errors);

  return mutateInOrg(
    ctx,
    {
      capability: 'invoices_issue',
      action: 'approve',
      capTransaction: true,
      refusals: [{ constraint: 'payment_requests_one_final_account', code: 'request_exists' }],
    },
    async (tx, audit) => {
      const contract = await lockBillableContract(tx, contractId);
      const money = await loadContractMoneyFacts(tx, contractId);
      if (money.finalAccount) fail('request_exists');
      if (money.openVariationCount > 0) fail('open_variations');
      const basis = { ...contract, ...money };
      const figures = finalAccountFigures(basis, await loadMeasuredWorks(tx, contractId));
      const balance4 = parseMoney4(figures.balance);
      if (balance4 <= 0n) fail('final_account_nothing_due');
      if (!withinMagnitude(figures.balance)) fail('final_account_too_large');
      if (shown === OVER_CAP || balance4 !== parseMoney4(shown)) fail('final_account_changed', { amount: figures.balance });
      const taxAmount = finalAccountTax({
        contractTaxAmount: contract.taxAmount,
        taxRate: contract.taxRate,
        supervisionPct: contract.supervisionPct,
        approvedVariationNetDeltas: money.approvedVariationNetDeltas,
        adjustmentWorks: figures.adjustmentWorks,
        issuedRequestsTax: await issuedRequestsTax(tx, contractId),
        amount: figures.balance,
      });
      return insertPaymentRequest(tx, ctx, audit, {
        contractId,
        kind: 'final_account',
        milestoneId: null,
        variationOrderId: null,
        amount: figures.balance,
        taxAmount,
        issuedOn,
        ...read.values,
      });
    },
  );
}
