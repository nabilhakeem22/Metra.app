// What is still due on one payment request. PURE and CLIENT-SAFE: the record
// payment core, the client's "I paid" claim and the /d card read one figure.
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';

/**
 * amount minus every payment against it, never below zero. Over-payment is
 * refused at the write (`payment_exceeds_request`), so the floor only keeps a
 * corrupted ledger from showing the client a negative balance.
 */
export function requestOutstanding(amount: string, payments: string[]): string {
  const paid4 = payments.reduce((total, payment) => total + parseMoney4(payment), 0n);
  const outstanding4 = parseMoney4(amount) - paid4;
  return formatMoney4(outstanding4 > 0n ? outstanding4 : 0n);
}
