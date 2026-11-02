'use client';

import { useRef, useState, useTransition } from 'react';
import type { NamedCodeAnswer, VariationDecision } from '@/lib/client-home/code-answers';
import { signerNameOf } from '@/lib/client-home/signer-name';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { decideVariationInHome } from '../variation-actions';
import { decideFailureOf, decideFailureRefreshes, type ShownDecideFailure } from './change-order-decide-failure';
import { refreshUnlessOffline } from './refresh-unless-offline';
import { useActNameBox, type ActNameBox } from './use-act-name-box';
import { useClientCode, type ClientCode, type KnownCodeChannel } from './use-client-code';

/** What the section says after a decision was answered: approved, rejected, already decided, or why not. */
export type DecideNotice = { kind: 'approved' | 'rejected' | 'already' } | { kind: 'refused'; failure: ShownDecideFailure };

export interface ChangeOrderDecision {
  box: ActNameBox;
  /** The decision being confirmed: its dialog is open, with the code panel. Null while none is. */
  decision: VariationDecision | null;
  /** The decision is in flight. */
  pending: boolean;
  /** The order's one-time code: one serves both decisions, so it survives changing from one to the other. */
  code: ClientCode;
  /** [Approve] or [Reject]: with no name, marks the box and moves the caret there; with one, opens the dialog. Sends nothing. */
  start: (decision: VariationDecision) => void;
  /** Close the dialog without sending anything. */
  dismiss: () => void;
  /** The dialog's Confirm: decides with the name and the typed code. */
  confirm: () => void;
}

/**
 * The behaviour behind approving or rejecting the change order `variationId` in
 * the home, with the client's typed name and a one-time code (OD2 strict), as
 * signing the contract (./use-contract-signing.ts). Only Confirm sends
 * `decideVariationInHome`, once, its await wrapped so a rejected action never
 * strands the spinner. `code_used` reads as already decided (OD-5): codes are
 * used up only by a decision, and none is made for a decided order. A refusal
 * about the code is said in the panel and the dialog stays open; any other
 * answer closes it and is handed to `onNotice`. An answer that moved the order,
 * or one that never came, reads the page again (`onChanged`).
 */
export function useChangeOrderDecision(
  token: string,
  variationId: string,
  channel: KnownCodeChannel,
  onNotice: (notice: DecideNotice | null) => void,
  onChanged: () => void,
  typingFor: string | null,
): ChangeOrderDecision {
  const [decision, setDecision] = useState<VariationDecision | null>(null);
  const box = useActNameBox(decision !== null);
  const [pending, startTransition] = useTransition();
  // Up from Confirm until its answer: a double tap in one tick decides once.
  const sending = useRef(false);

  function settle(notice: DecideNotice) {
    setDecision(null);
    onNotice(notice);
    if (notice.kind !== 'refused' || decideFailureRefreshes(notice.failure)) refreshUnlessOffline(onChanged);
  }
  const code = useClientCode(token, 'decide_variation', decision ? variationId : null, channel, () => settle({ kind: 'refused', failure: { error: 'wrong_state' } }), typingFor);

  function start(chosen: VariationDecision) {
    onNotice(null);
    if (signerNameOf(box.name) === null) return box.refuse();
    setDecision(chosen);
  }

  /** The name was refused in the dialog (a direct call's answer): close it and mark the box. */
  function nameRefused() {
    setDecision(null);
    box.refuseAfterDialog();
  }

  function hear(chosen: VariationDecision, answer: NamedCodeAnswer) {
    if (answer.ok) return settle({ kind: answer.already ? 'already' : chosen === 'approve' ? 'approved' : 'rejected' });
    if (answer.error === 'code_used') return settle({ kind: 'already' });
    if (answer.error === 'name_required') return nameRefused();
    if (!code.heard(answer)) settle({ kind: 'refused', failure: decideFailureOf(answer) });
  }

  function confirm() {
    const proof = code.proof();
    const signer = signerNameOf(box.name);
    if (!proof || decision === null || sending.current) return;
    if (signer === null) return nameRefused();
    const chosen = decision;
    sending.current = true;
    startTransition(async () => {
      try {
        hear(chosen, await decideVariationInHome(token, { variationId, decision: chosen, name: signer, code: proof.code }));
      } catch {
        settle({ kind: 'refused', failure: UNCONFIRMED_WRITE });
      } finally {
        sending.current = false;
      }
    });
  }

  return { box, decision, pending, code, start, dismiss: () => setDecision(null), confirm };
}
