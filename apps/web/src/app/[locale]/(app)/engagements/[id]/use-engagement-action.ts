'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { keyForAttempt, releasesKey } from '@/lib/engagements/retry-policy';
import type { Trigger } from '@/lib/engagements/transitions';
import { readHeldKeys, writeHeldKeys } from './held-keys-store';

export interface EngagementActionApi {
  pending: boolean;
  error: ActionCode | null;
  runAction(
    fn: (idempotencyKey: string) => Promise<ActionResult>,
    trigger?: Trigger,
  ): void;
}

export interface EngagementActionOptions {
  engagementId: string;
  /** Injected so a test can assert key IDENTITY rather than UUID shape.
   *  Defaults to crypto.randomUUID. */
  mintKey?: () => string;
}

/**
 * Run one server action and refresh on success. THE single entry point for
 * every write on the engagement page -- all thirteen call sites reach the server
 * through here -- which is why both guards below belong here and not in a form.
 *
 * THE IN-FLIGHT REF CLOSES THE DOUBLE-SUBMIT WINDOW. `pending` comes from
 * `useTransition` and only flips on a SUBSEQUENT render, so two clicks inside
 * one frame both see `pending === false` and both dispatch. That was harmless
 * while these actions were idempotent column writes; it stopped being harmless
 * when they began appending to a ledger whose grants are INSERT and SELECT
 * only, so a duplicated row cannot be taken back. A ref is read and written
 * synchronously, so the second click in the same frame sees the first.
 *
 * It is HERE rather than in `FormActions` because only five of the thirteen
 * call sites are forms. The other eight -- Advance, the off-plan toggle, the
 * revision form, the payment form, every secondary trigger including the
 * terminal `abandon` -- would have been left open by a latch inside the form
 * component.
 *
 * THE try/catch IS LOAD-BEARING for the same controls. `pending` gates the
 * command card, all five tab headers and every panel form; if `fn()` REJECTS --
 * offline, a Worker rolling mid-request, a half-open origin -- an unguarded
 * transition never settles and all of them stay disabled with no way back but a
 * reload. A rejection is a transport failure rather than a coded refusal, so it
 * surfaces as `generic`; the action's own failures already return
 * `{ok:false, error}`. It is logged because otherwise it leaves no trace
 * anywhere: `mutateInOrg` never saw it, so the server has nothing either.
 *
 * `finally` releases the ref unconditionally. Tying the release to `pending`
 * instead would strand the page forever on any path where a transition never
 * starts.
 */
export function useEngagementAction(
  options: EngagementActionOptions,
): EngagementActionApi {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);
  // Guards the frame-sized window `pending` cannot -- see above.
  const inFlight = useRef(false);
  /**
   * The idempotency key of each attempt currently in doubt (0050), BY TRIGGER.
   *
   * Per trigger, not per page. One shared key meant that any of the fifteen
   * actions on this screen — an upload, a payment, the off-plan toggle —
   * released the key a half-finished `requestRevision` was holding, and its
   * retry then minted a fresh one: a second ledger row and a second allowance
   * spent, caused by a success that had nothing to do with it.
   *
   * A key is NOT released when its action fails: it is released when we KNOW
   * what happened. A definite refusal means the transaction rolled back, so the
   * next click is a new attempt and gets a new key. 'uncertain', 'generic' and a
   * thrown rejection mean the opposite — the write may have committed and only
   * the answer was lost — so the key survives and the retry is recognised as the
   * same act. See lib/engagements/retry-policy.ts for both rules.
   *
   * SEEDED FROM sessionStorage on the first render of this mount (A9), so a key
   * held for an attempt in doubt survives a remount — a soft navigation away and
   * back, a Fast Refresh, a router.refresh() that replaces the tree. Without it
   * the retry after a remount mints a fresh key, which is a fresh act: one
   * duplicate revision, or one duplicate attestation. See held-keys-store.ts.
   */
  const pendingKeys = useRef<Map<Trigger, string> | null>(null);
  pendingKeys.current ??= readHeldKeys(options.engagementId);
  const held = pendingKeys.current;
  const mintKey = options.mintKey ?? (() => crypto.randomUUID());

  /** Every mutation of the map goes through here, so the mirror cannot drift. */
  function persistHeldKeys(): void {
    writeHeldKeys(options.engagementId, held);
  }

  function settle(trigger: Trigger | undefined, result: ActionResult): void {
    // Only THIS trigger's key is ever touched, and only when the answer is
    // "it worked" or a DEFINITE refusal — a guard verdict, a forbidden
    // capability, a state conflict, all of which rolled their transaction
    // back. `generic`, `uncertain` and any code this build has not heard of
    // may all mean the write landed and the answer was lost, so they hold.
    if (trigger && releasesKey(result)) {
      held.delete(trigger);
      persistHeldKeys();
    }
    if (result.ok) router.refresh();
    else setError((result.error as ActionCode) ?? 'generic');
  }

  function runAction(
    fn: (idempotencyKey: string) => Promise<ActionResult>,
    trigger?: Trigger,
  ): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    // ONE key per ATTEMPT AT ONE TRIGGER, HELD across a retry the user makes
    // because they were not told what happened. It is minted here rather than
    // per click, because the whole point is that the RETRY carries the SAME key
    // as the attempt it is retrying — a fresh key would be a fresh act and would
    // spend a second free revision. See the ref's declaration for the rest.
    const idempotencyKey = keyForAttempt(held, trigger, mintKey);
    if (trigger) {
      held.set(trigger, idempotencyKey);
      persistHeldKeys();
    }
    startTransition(async () => {
      try {
        settle(trigger, await fn(idempotencyKey));
      } catch (cause) {
        // A rejection is the client-side twin of 'uncertain' — the request may
        // have reached Postgres and committed, and only the response was lost.
        // So the key is HELD here too; releasing it would hand the retry a fresh
        // identity and reopen exactly the double-apply this exists to close.
        console.error('engagement action failed before returning a result', cause);
        setError('generic');
      } finally {
        inFlight.current = false;
      }
    });
  }

  return { pending, error, runAction };
}
