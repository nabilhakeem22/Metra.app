// When a payment's idempotency key is one the contract's ledger already holds
// (A4 F4, S2). PURE: the core asks it under the request's row lock, and again
// when a concurrent write of the same key won the insert.
//
// The key names ONE payment: this request, this amount. A stored row that
// matches both is that payment arriving again after a lost answer, and the
// answer is the row (`already`). A row on another request, or of another
// amount, is a DIFFERENT payment that reused the key: answering it as `already`
// would tell the caller money was recorded that never was, so it is refused
// (`idempotency_conflict`) and nothing is written.
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';

export interface KeyedPayment {
  id: string;
  requestId: string;
  /** Scale-4, as stored. */
  amount: string;
}

export function isSamePayment(stored: KeyedPayment, attempt: { requestId: string; amount: string }): boolean {
  return stored.requestId === attempt.requestId && parseMoney4(stored.amount) === parseMoney4(attempt.amount);
}

/**
 * The idempotency key as the ledger keeps it: trimmed and lower-case, so the
 * upper-case spelling of a uuid is the same key and never a second payment.
 */
export function canonicalIdempotencyKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}
