'use client';

import { useState, useTransition } from 'react';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import { markDeliveryPaymentPaid } from '../actions';

export interface PaymentClaimSubmission {
  /** Any claim is in flight (every claim control disables while one is). */
  pending: boolean;
  /** The milestone whose claim is in flight, for its spinner. */
  submittingKind: string | null;
  /** Milestones claimed successfully in this session: a local optimistic flip to
   *  the waiting state, so the client sees the result before the next read. */
  claimedKinds: ReadonlySet<string>;
  /** Of those, the ones whose claim really reached the studio (a notification
   *  row was written): only these may say the team has been notified. */
  notifiedKinds: ReadonlySet<string>;
  /** The last failed claim, already narrowed to a key the catalog holds. */
  failure: { kind: string; error: PortalErrorKey } | null;
  claim: (milestoneKind: string) => void;
}

/**
 * The behaviour behind the payments card's "I've made this payment" controls: one
 * `markDeliveryPaymentPaid` at a time, the await wrapped so a rejected action can
 * never strand the spinner. The claim is advisory and idempotent (a repeat
 * resolves ok); the amount is locked server-side, so none is sent.
 */
export function usePaymentClaim(token: string): PaymentClaimSubmission {
  const [pending, startTransition] = useTransition();
  const [submittingKind, setSubmittingKind] = useState<string | null>(null);
  const [claimedKinds, setClaimedKinds] = useState<ReadonlySet<string>>(new Set());
  const [notifiedKinds, setNotifiedKinds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<PaymentClaimSubmission['failure']>(null);

  function claim(milestoneKind: string) {
    setFailure(null);
    setSubmittingKind(milestoneKind);
    startTransition(async () => {
      try {
        const result = await markDeliveryPaymentPaid(token, milestoneKind);
        if (result.ok) {
          setClaimedKinds((previous) => new Set(previous).add(milestoneKind));
          if (result.studioNotified) {
            setNotifiedKinds((previous) => new Set(previous).add(milestoneKind));
          }
        } else {
          setFailure({ kind: milestoneKind, error: portalErrorKey(result.error) });
        }
      } catch {
        setFailure({ kind: milestoneKind, error: 'generic' });
      } finally {
        setSubmittingKind(null);
      }
    });
  }

  return { pending, submittingKind, claimedKinds, notifiedKinds, failure, claim };
}
