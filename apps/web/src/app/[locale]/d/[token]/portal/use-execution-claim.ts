'use client';

import { useState, useTransition } from 'react';
import { isRequestClaimable } from '@/lib/engagements/public/execution-requests';
import type { PortalExecution } from '@/lib/engagements/public/execution-types';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { claimRequestInHome, loadDeliveryExecution } from '../execution-actions';
import { codeActFailureOf } from './code-act-failure';
import { useClientCode, type ClientCode, type KnownCodeChannel } from './use-client-code';

/**
 * A refused claim as its row says it: a shared portal failure, `wrong_state`
 * (the request moved on), or `not_received`: the answer was lost and the
 * payments, read again, do not show the claim, so the client may send it
 * again (a repeat is never counted twice: the database answers it `already`).
 * A refusal about the CODE is said in the code panel instead.
 */
export type ShownClaimFailure = ShownActFailure | { error: 'not_received' };

export interface ExecutionClaim {
  /** The payments as they are now: the page's read, the claims made since, then the next read. */
  execution: PortalExecution;
  /** A claim is in flight: every "I paid" disables while one is. */
  pending: boolean;
  /** The request whose "I paid" is open (its dialog, with the code panel), or null. */
  askingId: string | null;
  /** The request whose claim is in flight, for its spinner. */
  submittingId: string | null;
  /** Requests claimed in this visit: the studio was told in the same write. */
  notifiedIds: ReadonlySet<string>;
  /** The last refused claim, and the request it was for. */
  failure: { requestId: string; shown: ShownClaimFailure } | null;
  /** The open claim's one-time code. */
  code: ClientCode;
  /** Opens the claim for this request: its amount and the code panel. Sends nothing. */
  ask: (requestId: string) => void;
  /** Close the claim without sending anything. */
  dismiss: () => void;
  /** The dialog's Confirm: claims the open request with the typed code. */
  confirm: () => void;
}

/** The payments with one request shown as claimed now, until the next read says when. */
function withClaimShown(execution: PortalExecution, requestId: string): PortalExecution {
  const claimedAt = new Date().toISOString();
  return {
    ...execution,
    requests: execution.requests.map((request) =>
      request.id === requestId && request.claimedAt === null ? { ...request, claimedAt } : request,
    ),
  };
}

/**
 * The behaviour behind the Execution tab's "I've made this payment", with a
 * one-time code (OD2 strict). A tap opens the claim: the request and the amount
 * still due, and the code panel (./use-client-code.ts); `openOn` (a code
 * email's link) opens that request's claim on the code box at once. Only Confirm sends
 * `claimRequestInHome`, with the typed code, one at a time, its await wrapped
 * so a rejected action can never strand the spinner. The amount is the
 * server's, so none is sent. A wrong, spent or expired code is said in the
 * panel and the claim stays open; any other answer closes it.
 *
 * A claim that landed shows on its row at once, and `onChanged` refreshes the
 * page (one read of the home), whose hero and payments then follow; the
 * payments follow every new read the page hands down. A refusal because the
 * request moved on refreshes it too.
 *
 * AFTER A LOST ANSWER THE READ DECIDES (B4 F1): the row never says "sent" and
 * "we could not confirm it" at once. If the payments, read again, show the
 * claim, it landed (and told the studio in the same write). If the read works
 * and shows no claim, the row says it was not received and keeps its button.
 * Only when the read fails too does "refresh to check" stay.
 */
export function useExecutionClaim(
  token: string,
  initial: PortalExecution,
  onChanged: () => void,
  channel: KnownCodeChannel,
  openOn: string | null,
): ExecutionClaim {
  const [execution, setExecution] = useState(initial);
  const [readFromPage, setReadFromPage] = useState(initial);
  if (readFromPage !== initial) {
    setReadFromPage(initial);
    setExecution(initial);
  }
  const [pending, startTransition] = useTransition();
  // A code email's link opens its request's claim at once, while it can still be claimed.
  const [askingId, setAskingId] = useState(() =>
    initial.requests.some((request) => request.id === openOn && isRequestClaimable(request)) ? openOn : null,
  );
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [notifiedIds, setNotifiedIds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<ExecutionClaim['failure']>(null);

  /** The request moved on before a code could be sent: close it and show where it stands. */
  function gone() {
    if (askingId) setFailure({ requestId: askingId, shown: { error: 'wrong_state' } });
    setAskingId(null);
    onChanged();
  }
  const code = useClientCode(token, 'claim_request', askingId, channel, gone, openOn);

  /** One read of the payments, or null when it failed: the rows then keep what they show. */
  async function readAgain(): Promise<PortalExecution | null> {
    try {
      const answer = await loadDeliveryExecution(token);
      if (!answer.ok) return null;
      setExecution(answer.execution);
      return answer.execution;
    } catch {
      return null;
    }
  }

  /** A lost answer, settled by a read of the payments: what the row says afterwards. */
  async function settleLostAnswer(requestId: string, unconfirmed: ShownClaimFailure): Promise<void> {
    const read = await readAgain();
    if (read === null) {
      setFailure({ requestId, shown: unconfirmed });
      return;
    }
    const row = read.requests.find((request) => request.id === requestId);
    if (row?.claimedAt) {
      setNotifiedIds((previous) => new Set(previous).add(requestId));
      onChanged();
      return;
    }
    setFailure({ requestId, shown: { error: 'not_received' } });
  }

  function confirm() {
    const requestId = askingId;
    const proof = code.proof();
    if (!requestId || !proof) return;
    setFailure(null);
    setSubmittingId(requestId);
    startTransition(async () => {
      try {
        const answer = await claimRequestInHome(token, { requestId, ...proof });
        if (answer.ok) {
          if (!answer.already) setNotifiedIds((previous) => new Set(previous).add(requestId));
          setExecution((current) => withClaimShown(current, requestId));
          setAskingId(null);
          onChanged();
          return;
        }
        if (code.heard(answer)) return;
        setAskingId(null);
        if (answer.error === 'uncertain') {
          await settleLostAnswer(requestId, actFailureOf(answer));
          return;
        }
        const shown = codeActFailureOf(answer);
        setFailure({ requestId, shown });
        if (shown.error === 'wrong_state') onChanged();
      } catch {
        setAskingId(null);
        await settleLostAnswer(requestId, UNCONFIRMED_WRITE);
      } finally {
        setSubmittingId(null);
      }
    });
  }

  return {
    execution,
    pending,
    askingId,
    submittingId,
    notifiedIds,
    failure,
    code,
    ask: (requestId) => {
      setFailure(null);
      setAskingId(requestId);
    },
    dismiss: () => setAskingId(null),
    confirm,
  };
}
