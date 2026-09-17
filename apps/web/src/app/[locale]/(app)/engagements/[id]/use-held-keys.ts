'use client';

import { useRef, type RefObject } from 'react';
import { keyForAttempt } from '@/lib/engagements/retry-policy';
import type { Trigger } from '@/lib/engagements/transitions';
import { readHeldKeys, writeHeldKeys } from './held-keys-store';

/**
 * The idempotency key of each attempt currently in doubt (0050), BY TRIGGER and
 * BY ENGAGEMENT.
 *
 * Per trigger, not per page. One shared key meant that any of the fifteen
 * actions on this screen — an upload, a payment, the off-plan toggle — released
 * the key a half-finished `requestRevision` was holding, and its retry then
 * minted a fresh one: a second ledger row and a second allowance spent, caused
 * by a success that had nothing to do with it.
 *
 * A key is NOT released when its action fails: it is released when we KNOW what
 * happened. A definite refusal means the transaction rolled back, so the next
 * click is a new attempt and gets a new key. 'uncertain', 'generic' and a thrown
 * rejection mean the opposite — the write may have committed and only the answer
 * was lost — so the key survives and the retry is recognised as the same act.
 * See lib/engagements/retry-policy.ts for both rules.
 *
 * SEEDED FROM sessionStorage (A9), so a key held for an attempt in doubt
 * survives a remount — a soft navigation away and back, a Fast Refresh, a
 * router.refresh() that replaces the tree. Without it the retry after a remount
 * mints a fresh key, which is a fresh act: one duplicate revision, or one
 * duplicate attestation. See held-keys-store.ts.
 *
 * AND RE-SEEDED WHEN THE ENGAGEMENT CHANGES. The server page renders the cockpit
 * subtree with a `key`, so /engagements/e-1 -> /engagements/e-2 remounts it —
 * but a ref seeded once per mount is not an invariant anyone can rely on from
 * here, and without both halves e-2's write went out carrying e-1's key and
 * overwrote the entry e-1 was holding. So the map is tagged with the engagement
 * it belongs to and every read names its own engagement: an answer that arrives
 * after the studio has moved on still settles the engagement it was dispatched
 * for, and nothing is ever flushed under the wrong id.
 */
export interface HeldKeysApi {
  /**
   * The key the next attempt at `trigger` must carry — the one that engagement
   * is still holding, or a fresh one — recorded and mirrored before it is sent.
   */
  claim(
    engagementId: string,
    trigger: Trigger | undefined,
    mintKey: () => string,
  ): string;
  /** Drop the key `trigger` was holding on `engagementId`: that act is settled. */
  release(engagementId: string, trigger: Trigger): void;
}

interface SeededKeys {
  engagementId: string;
  held: Map<Trigger, string>;
}

/**
 * The live map for ONE engagement: the seeded one while that engagement is on
 * screen, otherwise whatever storage holds for it. The ref is only re-pointed
 * for the engagement being shown, so an answer landing for the one the studio
 * just left updates that one and leaves the current map alone.
 */
function keysFor(
  seeded: RefObject<SeededKeys | null>,
  engagementId: string,
  currentEngagementId: string,
): Map<Trigger, string> {
  const current = seeded.current;
  if (current?.engagementId === engagementId) return current.held;
  const held = readHeldKeys(engagementId);
  if (engagementId === currentEngagementId) seeded.current = { engagementId, held };
  return held;
}

export function useHeldKeys(currentEngagementId: string): HeldKeysApi {
  const seeded = useRef<SeededKeys | null>(null);
  return {
    claim(engagementId, trigger, mintKey) {
      const held = keysFor(seeded, engagementId, currentEngagementId);
      const idempotencyKey = keyForAttempt(held, trigger, mintKey);
      // An edge that passes no trigger holds nothing: it mints a key nobody
      // reads, so it can neither take nor release another act's key.
      if (trigger) {
        held.set(trigger, idempotencyKey);
        writeHeldKeys(engagementId, held);
      }
      return idempotencyKey;
    },
    release(engagementId, trigger) {
      const held = keysFor(seeded, engagementId, currentEngagementId);
      held.delete(trigger);
      writeHeldKeys(engagementId, held);
    },
  };
}
