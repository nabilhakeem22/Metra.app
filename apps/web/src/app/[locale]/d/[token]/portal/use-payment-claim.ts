'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ShownActFailure } from '@/lib/engagements/portal-error-key';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { claimDesignPaymentInHome } from '../actions';
import { codeActFailureOf } from './code-act-failure';
import { useClientCode, type ClientCode } from './use-client-code';

export interface PaymentClaimSubmission {
  /** Any claim is in flight (every claim control disables while one is). */
  pending: boolean;
  /** The milestone whose "I've made this payment" is open (its dialog, with the code panel), or null. */
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
  /** A milestone whose claim the server made moot (it stopped being claimable
   *  while the dialog was open): nothing was sent, and the card says so. */
  changedKind: string | null;
  /** The open claim's one-time code. */
  code: ClientCode;
  /** Opens the claim for this milestone: its amount and the code panel. Sends nothing. */
  ask: (milestoneKind: string) => void;
  /** Close the claim without sending anything. */
  dismiss: () => void;
  /** The dialog's Confirm: claims the open milestone with the typed code. */
  confirm: () => void;
  /** Close a claim the server made moot, and keep the reason for the card. */
  withdraw: (milestoneKind: string) => void;
}

/**
 * The behaviour behind the payments card's "I've made this payment" controls,
 * with a one-time code (OD2 strict). A tap opens the claim (the dialog names
 * the milestone and the amount, with the code panel); only Confirm sends
 * `claimDesignPaymentInHome` with the typed code, one at a time, the await
 * wrapped so a rejected action can never strand the spinner. A wrong, spent or
 * expired code is said in the panel and the claim stays open; any other answer
 * closes it. The claim is advisory and idempotent (a repeat resolves ok); the
 * amount is locked server-side, so none is sent. A claim that landed re-reads
 * the page from the server. `openOn` (a code email's link, already checked
 * claimable) opens that instalment's claim on the code box at once.
 */
export function usePaymentClaim(token: string, openOn: string | null): PaymentClaimSubmission {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [askingKind, setAskingKind] = useState(openOn);
  const [submittingKind, setSubmittingKind] = useState<string | null>(null);
  const [claimedKinds, setClaimedKinds] = useState<ReadonlySet<string>>(new Set());
  const [notifiedKinds, setNotifiedKinds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<PaymentClaimSubmission['failure']>(null);
  const [changedKind, setChangedKind] = useState<string | null>(null);

  const withdraw = (milestoneKind: string) => {
    setAskingKind(null);
    setChangedKind(milestoneKind);
  };
  /** The instalment stopped being claimable before a code could be sent: close it and show where it stands. */
  function gone() {
    if (askingKind) withdraw(askingKind);
    router.refresh();
  }
  const code = useClientCode(token, 'claim_design_payment', askingKind, 'unknown', gone, openOn);

  function confirm() {
    const milestoneKind = askingKind;
    const proof = code.proof();
    if (!milestoneKind || !proof) return;
    setFailure(null);
    setSubmittingKind(milestoneKind);
    startTransition(async () => {
      try {
        const result = await claimDesignPaymentInHome(token, { milestoneKind, ...proof });
        if (result.ok) {
          setClaimedKinds((previous) => new Set(previous).add(milestoneKind));
          if (result.studioNotified) setNotifiedKinds((previous) => new Set(previous).add(milestoneKind));
          setAskingKind(null);
          router.refresh();
          return;
        }
        if (code.heard(result)) return;
        setAskingKind(null);
        setFailure({ kind: milestoneKind, shown: codeActFailureOf(result) });
      } catch {
        // The claim may have been saved: refresh and check (UNCONFIRMED_WRITE).
        setAskingKind(null);
        setFailure({ kind: milestoneKind, shown: UNCONFIRMED_WRITE });
      } finally {
        setSubmittingKind(null);
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
    code,
    ask: (milestoneKind) => {
      setChangedKind(null);
      setAskingKind(milestoneKind);
    },
    dismiss: () => setAskingKind(null),
    confirm,
    withdraw,
  };
}
