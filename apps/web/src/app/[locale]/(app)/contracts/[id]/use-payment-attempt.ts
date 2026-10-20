'use client';

import { useRef } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import { releasesKey } from '@/lib/engagements/retry-policy';
import {
  clearPaymentAttempt,
  mayStillBeRunning,
  readPaymentAttempt,
  writePaymentAttempt,
  type HeldPaymentAttempt,
} from './payment-attempt-store';

/**
 * The idempotency key of one payment on one request, the rule the cockpit
 * keeps (lib/engagements/retry-policy.ts): ONE KEY PER DELIBERATE ACT, held
 * DURABLY (./payment-attempt-store.ts).
 *
 * `keyFor(act)` is the key to send, and stamps it as sent now: the held one
 * when it was minted for this act (a retry after an answer that could not say
 * what happened), a fresh one, stored BEFORE it is sent, when nothing is held,
 * and null when a DIFFERENT act is held. That last one is the case a lost
 * answer leaves behind: the first payment may be in the ledger already, and a
 * new key would record the second as well, so the dialog has the studio check
 * the payments first (previous-attempt-notice.tsx).
 *
 * `settle` releases the key only on an answer that says what happened: it
 * worked (including `already`), or the server definitely refused it.
 * `forget` releases it once a check says the attempt is settled.
 */
export function usePaymentAttempt(contractId: string, requestId: string) {
  // Read from storage once per dialog: the dialog mounts when it opens.
  const held = useRef<HeldPaymentAttempt | null | undefined>(undefined);
  if (held.current === undefined) held.current = readPaymentAttempt(contractId, requestId);

  function forget(): void {
    held.current = null;
    clearPaymentAttempt(contractId, requestId);
  }

  return {
    keyFor(act: string): string | null {
      const current = held.current;
      if (current && current.act !== act) return null;
      const sent = { key: current?.key ?? crypto.randomUUID(), act, sentAt: Date.now() };
      held.current = sent;
      writePaymentAttempt(contractId, requestId, sent);
      return sent.key;
    },
    /** The attempt held for this request, or null. */
    held(): HeldPaymentAttempt | null {
      return held.current ?? null;
    },
    /** Inside the server's write window of its last send: "not in the ledger" may mean "not yet". */
    mayStillBeRunning(): boolean {
      return held.current ? mayStillBeRunning(held.current, Date.now()) : false;
    },
    settle(answer: ActionResult | 'rejected'): void {
      if (releasesKey(answer)) forget();
    },
    forget,
  };
}

export type PaymentAttempt = ReturnType<typeof usePaymentAttempt>;
