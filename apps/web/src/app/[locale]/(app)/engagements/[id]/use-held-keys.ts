'use client';

import { useRef, type RefObject } from 'react';
import type { HeldKeyTrigger } from '@/lib/engagements/held-act';
import { hasLanded, keyForAttempt, type HeldKey } from '@/lib/engagements/held-key';
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
 * A RECORDED PAYMENT IS IN THIS MAP TOO, under PAYMENT_HELD_TRIGGER, named by
 * the kind and amount being recorded. It is not a lifecycle trigger, but the
 * server reads its key as the same proof of sameness — so before this it was the
 * one write on the screen minting a key per PANEL OPEN and bounded by nothing:
 * two genuinely different payments logged without closing the panel went out on
 * ONE key, and the second was answered with the first one's row.
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
 * AND BOUNDED, twice over: a key expires (HELD_KEY_TTL_MS) and a key the
 * engagement's own ledger already CARRIES is dropped before the next attempt
 * chooses one. Without either, the key named that trigger until the tab closed,
 * and a genuinely new act hours later was answered "already done" by the server
 * and silently discarded. See `@/lib/engagements/held-key`.
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
    trigger: HeldKeyTrigger | undefined,
    mintKey: () => string,
    /** What the act IS, where the trigger does not say it — see HeldKey.act. */
    act?: string,
  ): string;
  /** Drop the key `trigger` was holding on `engagementId`: that act is settled. */
  release(engagementId: string, trigger: HeldKeyTrigger): void;
}

interface SeededKeys {
  engagementId: string;
  held: Map<HeldKeyTrigger, HeldKey>;
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
): Map<HeldKeyTrigger, HeldKey> {
  const current = seeded.current;
  if (current?.engagementId === engagementId) return current.held;
  const held = readHeldKeys(engagementId);
  if (engagementId === currentEngagementId) seeded.current = { engagementId, held };
  return held;
}

/**
 * @param landedKeys every idempotency key the ledger of THIS ENGAGEMENT already
 * carries, from the transitions the page loaded. A key in there names an attempt
 * that committed after all.
 */
export function useHeldKeys(
  currentEngagementId: string,
  landedKeys?: ReadonlySet<string>,
): HeldKeysApi {
  const seeded = useRef<SeededKeys | null>(null);
  return {
    claim(engagementId, trigger, mintKey, act) {
      const held = keysFor(seeded, engagementId, currentEngagementId);
      // The ledger the page is showing says the attempt this key names landed
      // after all, which is what `uncertain` could not tell the studio. It has
      // done its job: this click is a NEW act and gets a new key.
      if (trigger && hasLanded(held.get(trigger), landedKeys)) {
        held.delete(trigger);
      }
      const attempt = keyForAttempt(held, trigger, mintKey, Date.now(), act);
      // An edge that passes no trigger holds nothing: it mints a key nobody
      // reads, so it can neither take nor release another act's key.
      if (trigger) {
        held.set(trigger, attempt);
        writeHeldKeys(engagementId, held);
      }
      return attempt.key;
    },
    release(engagementId, trigger) {
      const held = keysFor(seeded, engagementId, currentEngagementId);
      held.delete(trigger);
      writeHeldKeys(engagementId, held);
    },
  };
}
