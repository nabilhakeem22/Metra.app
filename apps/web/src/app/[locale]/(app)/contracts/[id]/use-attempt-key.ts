'use client';

import { useRef } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import { releasesKey } from '@/lib/engagements/retry-policy';

/**
 * The idempotency key of one money act, the rule the cockpit keeps
 * (lib/engagements/retry-policy.ts): ONE KEY PER DELIBERATE ACT.
 *
 * Claimed at submit and NAMED by everything the act carries (`act`), so a
 * second, different payment typed into the same dialog gets its own key and
 * is never answered with the first one's row. HELD across a retry of the same
 * act after an answer that could not say what happened (a lost connection, a
 * lock wait, `generic`): the retry carries the same key, and the server
 * answers the payment it already counted (`already: true`) instead of counting
 * it twice. Released when the answer is known: it worked, or the server
 * definitely refused it. Holding a key that could have been released costs
 * nothing: no row carries it, so the next attempt proceeds normally.
 */
export function useAttemptKey() {
  const held = useRef<{ act: string; key: string } | null>(null);
  return {
    claim(act: string): string {
      if (held.current?.act !== act) held.current = { act, key: crypto.randomUUID() };
      return held.current.key;
    },
    settle(answer: ActionResult | 'rejected'): void {
      if (releasesKey(answer)) held.current = null;
    },
  };
}
