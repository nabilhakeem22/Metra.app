'use client';

import { useRef, useState, useTransition } from 'react';
import { signerNameOf } from '@/lib/client-home/signer-name';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { signContractInHome } from '../contract-actions';
import { signFailureOf, signFailureRefreshes, type ShownSignFailure } from './contract-sign-failure';
import { refreshNowOrWhenOnline } from './refresh-now-or-when-online';
import { useActNameBox, type ActNameBox } from './use-act-name-box';
import { useClientCode, type ClientCode, type KnownCodeChannel } from './use-client-code';

/** What the contract section says after a signing was answered: signed, already signed, or why not. */
export type SignNotice = { kind: 'signed' | 'already' } | { kind: 'refused'; failure: ShownSignFailure };

export interface ContractSigning {
  /** The name box. */
  box: ActNameBox;
  /** The signing is open: its dialog, with the code panel. */
  asking: boolean;
  /** The signing is in flight. */
  pending: boolean;
  /** The signing's one-time code. */
  code: ClientCode;
  /** [Sign]: with no name, marks the box and moves the caret there; with one, opens the dialog. Sends nothing. */
  start: () => void;
  /** Close the dialog without sending anything. */
  dismiss: () => void;
  /** The dialog's Confirm: signs with the name and the typed code. */
  confirm: () => void;
}

/**
 * The behaviour behind signing the execution contract `contractId` in the
 * home, with the client's typed name and a one-time code (OD2 strict). [Sign]
 * with a blank name sends nothing; with a name it opens the dialog and its
 * code panel (./use-client-code.ts), on the code box for `typingFor` (a code
 * email's link). Only Confirm sends `signContractInHome`, once, its await
 * wrapped so a rejected action never strands the spinner. A refusal about the
 * code is said in the panel and the dialog stays open; any other answer
 * closes it and is handed to `onNotice` (the section says it, and keeps saying
 * it after the page is read again). An answer that moved the contract, or one
 * that never came, reads the page again (`onChanged`): the refreshed home
 * decides the hero and the card.
 */
export function useContractSigning(
  token: string,
  contractId: string,
  channel: KnownCodeChannel,
  onNotice: (notice: SignNotice | null) => void,
  onChanged: () => void,
  typingFor: string | null,
): ContractSigning {
  const [asking, setAsking] = useState(false);
  const box = useActNameBox(asking);
  const [pending, startTransition] = useTransition();
  // Up from Confirm until its answer: a double tap in one tick signs once.
  const sending = useRef(false);

  function settle(notice: SignNotice) {
    setAsking(false);
    onNotice(notice);
    if (notice.kind !== 'refused' || signFailureRefreshes(notice.failure)) refreshNowOrWhenOnline(onChanged);
  }
  const code = useClientCode(token, 'sign_contract', asking ? contractId : null, channel, () => settle({ kind: 'refused', failure: { error: 'wrong_state' } }), typingFor);

  function start() {
    onNotice(null);
    if (signerNameOf(box.name) === null) return box.refuse();
    setAsking(true);
  }

  /** The name was refused in the dialog (a direct call's answer): close it and mark the box. */
  function nameRefused() {
    setAsking(false);
    box.refuseAfterDialog();
  }

  function confirm() {
    const proof = code.proof();
    const signer = signerNameOf(box.name);
    if (!proof || sending.current) return;
    if (signer === null) return nameRefused();
    sending.current = true;
    startTransition(async () => {
      try {
        const answer = await signContractInHome(token, { contractId, name: signer, code: proof.code });
        if (answer.ok) return settle({ kind: answer.already ? 'already' : 'signed' });
        if (answer.error === 'name_required') return nameRefused();
        if (code.heard(answer)) return;
        settle({ kind: 'refused', failure: signFailureOf(answer) });
      } catch {
        settle({ kind: 'refused', failure: UNCONFIRMED_WRITE });
      } finally {
        sending.current = false;
      }
    });
  }

  return { box, asking, pending, code, start, dismiss: () => setAsking(false), confirm };
}
