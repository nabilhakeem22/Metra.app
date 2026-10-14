'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
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
  /** The last failed claim (its answer narrowed to a key the portal says; a lost
   *  answer is `uncertain`), and the milestone it was for. */
  failure: { kind: string; shown: ShownActFailure } | null;
  /** A milestone whose confirmation a refresh made moot (it stopped being
   *  claimable while the dialog was open): nothing was sent, and the card says so. */
  changedKind: string | null;
  /** Ask first: opens the confirmation for this milestone. Sends nothing. */
  ask: (milestoneKind: string) => void;
  /** Close the confirmation without sending anything. */
  dismiss: () => void;
  /** The confirmation's Confirm: claims the milestone being asked about. */
  confirm: () => void;
  /** Close a confirmation the server made moot, and keep the reason for the card. */
  withdraw: (milestoneKind: string) => void;
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
  const [changedKind, setChangedKind] = useState<string | null>(null);

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
          setFailure({ kind: milestoneKind, shown: actFailureOf(result) });
        }
      } catch {
        // The claim may have been saved: refresh and check (UNCONFIRMED_WRITE).
        setFailure({ kind: milestoneKind, shown: UNCONFIRMED_WRITE });
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
    changedKind,
    ask: (milestoneKind) => {
      setChangedKind(null);
      setAskingKind(milestoneKind);
    },
    dismiss: () => setAskingKind(null),
    confirm,
    withdraw: (milestoneKind) => {
      setAskingKind(null);
      setChangedKind(milestoneKind);
    },
  };
}
