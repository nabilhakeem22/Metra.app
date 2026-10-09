'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { portalErrorKey, type PortalErrorKey } from '@/lib/engagements/portal-error-key';
import { markDeliveryPaymentPaid } from '../actions';

export interface PaymentClaimSubmission {
  /** Any claim is in flight (every claim control disables while one is). */
  pending: boolean;
  /** The milestone whose "I've made this payment" asked to be confirmed, or null. */
  askingKind: string | null;
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
  /** Ask first: opens the confirmation for this milestone. Sends nothing. */
  ask: (milestoneKind: string) => void;
  /** Close the confirmation without sending anything. */
  dismiss: () => void;
  /** The confirmation's Confirm: claims the milestone being asked about. */
  confirm: () => void;
}

/**
 * The behaviour behind the payments card's "I've made this payment" controls.
 * A tap ASKS (the dialog names the milestone and the amount); only Confirm
 * sends `markDeliveryPaymentPaid`, one at a time, the await wrapped so a
 * rejected action can never strand the spinner. The claim is advisory and
 * idempotent (a repeat resolves ok); the amount is locked server-side, so none
 * is sent. A claim that landed re-reads the page from the server.
 */
export function usePaymentClaim(token: string): PaymentClaimSubmission {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [askingKind, setAskingKind] = useState<string | null>(null);
  const [submittingKind, setSubmittingKind] = useState<string | null>(null);
  const [claimedKinds, setClaimedKinds] = useState<ReadonlySet<string>>(new Set());
  const [notifiedKinds, setNotifiedKinds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<PaymentClaimSubmission['failure']>(null);

  function confirm() {
    const milestoneKind = askingKind;
    if (!milestoneKind) return;
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
          router.refresh();
        } else {
          setFailure({ kind: milestoneKind, error: portalErrorKey(result.error) });
        }
      } catch {
        setFailure({ kind: milestoneKind, error: 'generic' });
      } finally {
        setSubmittingKind(null);
        setAskingKind(null);
      }
    });
  }

  return {
    pending,
    askingKind,
    submittingKind,
    claimedKinds,
    notifiedKinds,
    failure,
    ask: setAskingKind,
    dismiss: () => setAskingKind(null),
    confirm,
  };
}
