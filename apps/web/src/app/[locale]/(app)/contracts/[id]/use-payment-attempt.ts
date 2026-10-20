'use client';

import { useRef } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import { releasesKey } from '@/lib/engagements/retry-policy';
import {
  clearPaymentAttempt,
  readPaymentAttempt,
  writePaymentAttempt,
  type HeldPaymentAttempt,
} from './payment-attempt-store';

/**
 * The idempotency key of one payment on one request, the rule the cockpit
 * keeps (lib/engagements/retry-policy.ts): ONE KEY PER DELIBERATE ACT, held
 * DURABLY (./payment-attempt-store.ts).
 *
 * `keyFor(act)` is the key to send: the held one when it was minted for this
 * act (a retry after an answer that could not say what happened), a fresh one,
 * stored BEFORE it is sent, when nothing is held, and null when a DIFFERENT act
 * is held. That last one is the case a lost answer leaves behind: the first
 * payment may be in the ledger already, and a new key would record the second
 * as well, so the dialog asks the studio to check the payments first.
 *
 * `settle` releases the key only on an answer that says what happened: it
 * worked (including `already`), or the server definitely refused it.
 * `forget` releases it once the studio has seen the payments read again.
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
      if (current) return current.act === act ? current.key : null;
      const fresh = { key: crypto.randomUUID(), act };
      held.current = fresh;
      writePaymentAttempt(contractId, requestId, fresh);
      return fresh.key;
    },
    settle(answer: ActionResult | 'rejected'): void {
      if (releasesKey(answer)) forget();
    },
    forget,
  };
}
