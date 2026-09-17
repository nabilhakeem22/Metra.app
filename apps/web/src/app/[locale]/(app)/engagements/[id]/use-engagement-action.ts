'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import type { HeldKeyTrigger } from '@/lib/engagements/held-key';
import { releasesKey } from '@/lib/engagements/retry-policy';
import { useHeldKeys } from './use-held-keys';

/**
 * Runs ONE server action with the idempotency key held for the act it belongs to
 * (0050). `trigger` names the act — a payment is not a lifecycle trigger and
 * holds its key under PAYMENT_HELD_TRIGGER; `act` describes WHICH one, where the
 * name does not (see HeldKey.act). An edge that needs no key passes neither and
 * ignores the argument.
 */
export type RunAction = (
  fn: (idempotencyKey: string) => Promise<ActionResult>,
  trigger?: HeldKeyTrigger,
  act?: string,
) => void;

export interface EngagementActionApi {
  pending: boolean;
  error: ActionCode | null;
  runAction: RunAction;
}

export interface EngagementActionOptions {
  engagementId: string;
  /**
   * When each trigger last produced a transition on this engagement, epoch ms,
   * from the ledger the page already loaded. A held key whose act the ledger
   * says has landed is dropped rather than reused — see held-key.ts.
   */
  landedAt?: ReadonlyMap<string, number>;
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
  // The keys of the attempts currently in doubt, per trigger and per
  // engagement, mirrored to sessionStorage. See use-held-keys.ts.
  const heldKeys = useHeldKeys(options.engagementId, options.landedAt);
  const mintKey = options.mintKey ?? (() => crypto.randomUUID());

  function settle(
    engagementId: string,
    trigger: HeldKeyTrigger | undefined,
    result: ActionResult,
  ): void {
    // Only THIS trigger's key on THIS engagement is ever touched, and only when
    // the answer is "it worked" or a DEFINITE refusal — a guard verdict, a
    // forbidden capability, a state conflict, all of which rolled their
    // transaction back. `generic`, `uncertain` and any code this build has not
    // heard of may all mean the write landed and the answer was lost, so they
    // hold.
    if (trigger && releasesKey(result)) heldKeys.release(engagementId, trigger);
    if (result.ok) router.refresh();
    else setError((result.error as ActionCode) ?? 'generic');
  }

  function runAction(
    fn: (idempotencyKey: string) => Promise<ActionResult>,
    trigger?: HeldKeyTrigger,
    act?: string,
  ): void {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    // The engagement this attempt belongs to, read ONCE. A soft navigation while
    // it is in flight must not settle whichever engagement is on screen when the
    // answer lands.
    const engagementId = options.engagementId;
    // ONE key per ATTEMPT AT ONE ACT, HELD across a retry the user makes because
    // they were not told what happened. It is claimed here rather than per
    // click, because the whole point is that the RETRY carries the SAME key as
    // the attempt it is retrying — a fresh key would be a fresh act and would
    // spend a second free revision. The act is the trigger, narrowed by `act`
    // where the trigger does not say what was attempted (a payment's kind and
    // amount): a different figure is a different act. See use-held-keys.ts.
    const idempotencyKey = heldKeys.claim(engagementId, trigger, mintKey, act);
    startTransition(async () => {
      try {
        settle(engagementId, trigger, await fn(idempotencyKey));
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
