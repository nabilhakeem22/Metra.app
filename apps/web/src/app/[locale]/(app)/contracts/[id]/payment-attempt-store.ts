import type { CleanContractPayment } from '@/lib/execution/payments/input';
import { actFrom } from '@/lib/engagements/held-act';
import { isUuid } from '@/lib/uuid';

/**
 * The idempotency key of a payment recorded from the Payments tab, HELD in
 * sessionStorage per contract and request (A4 F1), the cockpit's pattern
 * (engagements/[id]/held-keys-store.ts).
 *
 * In a `useRef` the key died with the dialog: a lost answer, a tab switch and a
 * retry minted a fresh key, and the ledger, which is append-only, took the
 * payment twice. Stored here it survives a dialog close, a tab switch and a page
 * remount, and the retry carries it until an answer says what happened (it
 * worked, it was already recorded, or it was definitely refused).
 *
 * sessionStorage, not localStorage: the key dies with the browser tab, so it
 * never names an attempt from another day. ONE entry per request, with the act
 * it was minted for (a hash of the payment's values, so the amount is not kept
 * in the clear): a held key is only ever sent with the same act, and a
 * different act on that request waits until the studio has checked the
 * payments (record-payment-dialog.tsx).
 *
 * EVERY call is wrapped, as the cockpit's are: Safari private mode throws on
 * sessionStorage ACCESS. Storage refused, the dialog's own copy still holds the
 * key for as long as it is open.
 */
export interface HeldPaymentAttempt {
  key: string;
  /** What the attempt was: paymentActOf of its values. */
  act: string;
  /** When it was last SENT (epoch ms, this browser's clock): a retry refreshes it. */
  sentAt: number;
}

/**
 * How long a sent attempt may still be running on the server: the app's
 * lock_timeout (5 s, packages/db/src/org-context.ts) plus its 15 s write
 * deadline. Inside it, "no payment under this key" may only mean "not yet"
 * (A4 N1), so the key is not released on that answer. One clock measures an
 * interval against itself, so a skewed laptop clock does not matter.
 */
export const PAYMENT_WRITE_WINDOW_MS = 20_000;

/** May the attempt still be running on the server, `now` being this browser's clock? */
export function mayStillBeRunning(attempt: HeldPaymentAttempt, now: number): boolean {
  return now - attempt.sentAt < PAYMENT_WRITE_WINDOW_MS;
}

const ACT_SHAPE = /^[0-9a-f]{16}$/;

export function paymentAttemptStorageKey(contractId: string, requestId: string): string {
  return `metra.paymentAttempt.${contractId}.${requestId}`;
}

/** The act a payment IS: every value it carries, canonical (the amount at scale 4, the texts trimmed). */
export function paymentActOf(requestId: string, payment: CleanContractPayment): string {
  return actFrom({ requestId, ...payment });
}

/**
 * The attempt held for this request, or null. The key goes to the server as
 * the idempotency key and sessionStorage is writable by devtools or a script,
 * so an entry that is not a uuid, an act hash and an instant is dropped, never
 * sent.
 */
export function readPaymentAttempt(contractId: string, requestId: string): HeldPaymentAttempt | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(paymentAttemptStorageKey(contractId, requestId));
    if (!raw) return null;
    const { key, act, sentAt } = JSON.parse(raw) as { key?: unknown; act?: unknown; sentAt?: unknown };
    if (isUuid(key) && typeof act === 'string' && ACT_SHAPE.test(act) && typeof sentAt === 'number' && Number.isFinite(sentAt)) {
      return { key, act, sentAt };
    }
    clearPaymentAttempt(contractId, requestId);
    return null;
  } catch {
    return null;
  }
}

export function writePaymentAttempt(contractId: string, requestId: string, attempt: HeldPaymentAttempt): void {
  try {
    globalThis.sessionStorage?.setItem(paymentAttemptStorageKey(contractId, requestId), JSON.stringify(attempt));
  } catch {
    // Storage refused: the dialog's own copy is all that holds the key.
  }
}

export function clearPaymentAttempt(contractId: string, requestId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(paymentAttemptStorageKey(contractId, requestId));
  } catch {
    // Storage refused: nothing was stored either.
  }
}
