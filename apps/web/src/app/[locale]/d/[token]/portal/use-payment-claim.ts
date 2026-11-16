'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ShownActFailure } from '@/lib/engagements/portal-error-key';
import { paymentClaimState } from '@/lib/engagements/portal-payments';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { refusalSaysMovedOn } from '@/lib/engagements/review-outcome';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { claimDesignPaymentInHome } from '../actions';
import { claimsNotYetRead } from './claims-not-yet-read';
import { codeActFailureOf } from './code-act-failure';
import { refreshNowOrWhenOnline } from './refresh-now-or-when-online';
import { useClientCode, type ClientCode } from './use-client-code';

export interface PaymentClaimSubmission {
  /** Any claim is in flight (every claim control disables while one is). */
  pending: boolean;
  /** The milestone whose "I've made this payment" is open (its dialog, with the code panel), or null. */
  askingKind: string | null;
  /** The milestone whose claim is in flight, for its spinner. */
  submittingKind: string | null;
  /** Milestones claimed successfully in this session and not yet shown pending by
   *  a read: a local optimistic flip to the waiting state, so the client sees the
   *  result before the next read. */
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
 * the page from the server, and so does a refusal that says the instalment or the
 * delivery moved on or closed (the set the hero acts read,
 * lib/engagements/review-outcome.ts) and an answer that was lost; an offline phone
 * waits for its network (./refresh-now-or-when-online.ts): the row draws a failure only
 * while it can still be claimed, so a claim that did land shows as waiting, never as failed.
 * Once a read shows a claim pending, the server is the truth for that instalment:
 * the local flip and any failure line on it go, so a later dismissal by the studio
 * shows the row claimable again, in step with the card above it. `openOn` (a code
 * email's link, already checked claimable) opens that instalment's claim on the
 * code box at once.
 */
export function usePaymentClaim(token: string, claim: PublicDelivery['paymentClaim'], openOn: string | null): PaymentClaimSubmission {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [askingKind, setAskingKind] = useState(openOn);
  const [submittingKind, setSubmittingKind] = useState<string | null>(null);
  const [claimedKinds, setClaimedKinds] = useState<ReadonlySet<string>>(new Set());
  const [notifiedKinds, setNotifiedKinds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<PaymentClaimSubmission['failure']>(null);
  const [changedKind, setChangedKind] = useState<string | null>(null);

  const unread = claimsNotYetRead(claimedKinds, claim);
  if (unread !== claimedKinds) setClaimedKinds(unread);
  if (failure && paymentClaimState(claim, failure.kind, new Set()).kind === 'pending') setFailure(null);

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
          // A claim made again after a dismissal says only what THIS one did.
          setNotifiedKinds((previous) => {
            const notified = new Set(previous);
            if (result.studioNotified) notified.add(milestoneKind);
            else notified.delete(milestoneKind);
            return notified;
          });
          setAskingKind(null);
          refreshNowOrWhenOnline(router.refresh);
          return;
        }
        if (code.heard(result)) return;
        setAskingKind(null);
        const shown = codeActFailureOf(result);
        setFailure({ kind: milestoneKind, shown });
        if (refusalSaysMovedOn(shown.error)) router.refresh();
        else if (shown.error === 'uncertain') refreshNowOrWhenOnline(router.refresh);
      } catch {
        // The claim may have been saved: refresh and check (UNCONFIRMED_WRITE).
        setAskingKind(null);
        setFailure({ kind: milestoneKind, shown: UNCONFIRMED_WRITE });
        refreshNowOrWhenOnline(router.refresh);
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
