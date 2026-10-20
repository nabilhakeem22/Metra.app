'use client';

import { useState, useTransition } from 'react';
import type { PortalExecution } from '@/lib/engagements/public/execution-types';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { claimExecutionRequest, loadDeliveryExecution } from '../execution-actions';

/**
 * A refused claim as the card says it: a shared portal failure, `wrong_state`,
 * the flood ceiling, or `not_received`: the answer was lost and the card, read
 * again, does not show the claim, so the client may send it again (a repeat is
 * never counted twice: the database answers it `already`).
 */
export type ShownClaimFailure = ShownActFailure | { error: 'busy' } | { error: 'not_received' };

export interface ExecutionClaim {
  /** The card as it is now: the page's read, then the answer of each claim. */
  execution: PortalExecution;
  /** A claim is in flight: every "I paid" disables while one is. */
  pending: boolean;
  /** The request whose "I paid" asked to be confirmed, or null. */
  askingId: string | null;
  /** The request whose claim is in flight, for its spinner. */
  submittingId: string | null;
  /** Requests claimed in this visit: the studio was told in the same write. */
  notifiedIds: ReadonlySet<string>;
  /** The last refused claim, and the request it was for. */
  failure: { requestId: string; shown: ShownClaimFailure } | null;
  /** Ask first: opens the confirmation for this request. Sends nothing. */
  ask: (requestId: string) => void;
  /** Close the confirmation without sending anything. */
  dismiss: () => void;
  /** The confirmation's Confirm: claims the request being asked about. */
  confirm: () => void;
}

/**
 * The behaviour behind the execution card's "I've made this payment". A tap ASKS
 * (the dialog names the request and the amount still due); only Confirm sends
 * `claimExecutionRequest`, one at a time, its await wrapped so a rejected action
 * can never strand the spinner. The amount is the server's, so none is sent.
 * A claim that landed answers with the card as it is now. An answer that could
 * not say what happened (a lost one, `uncertain`), or a refusal because the
 * request moved on (`wrong_state`), is followed by one read of the card.
 *
 * AFTER A LOST ANSWER THE READ DECIDES (B4 F1): the card never says "sent" and
 * "we could not confirm it" on the same row. If the read shows the claim, it
 * landed (and told the studio in the same write): the failure is cleared. If
 * the read works and shows no claim, the row says it was not received and keeps
 * its button. Only when the read fails too does "refresh to check" stay.
 */
export function useExecutionClaim(token: string, initial: PortalExecution): ExecutionClaim {
  const [execution, setExecution] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [askingId, setAskingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [notifiedIds, setNotifiedIds] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<ExecutionClaim['failure']>(null);

  /** One read of the card, or null when it failed: the card then keeps what it shows. */
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

  /** A lost answer, settled by a read of the card: what the row says afterwards. */
  async function settleLostAnswer(requestId: string, unconfirmed: ShownClaimFailure): Promise<void> {
    const card = await readAgain();
    if (card === null) {
      setFailure({ requestId, shown: unconfirmed });
      return;
    }
    const row = card.requests.find((request) => request.id === requestId);
    if (row?.claimedAt) {
      setNotifiedIds((previous) => new Set(previous).add(requestId));
      return;
    }
    setFailure({ requestId, shown: { error: 'not_received' } });
  }

  function confirm() {
    const requestId = askingId;
    if (!requestId) return;
    setFailure(null);
    setSubmittingId(requestId);
    startTransition(async () => {
      try {
        const answer = await claimExecutionRequest(token, requestId);
        if (answer.ok) {
          if (!answer.already) setNotifiedIds((previous) => new Set(previous).add(requestId));
          if (answer.execution) setExecution(answer.execution);
          else await readAgain();
          return;
        }
        if (answer.error === 'uncertain') {
          await settleLostAnswer(requestId, actFailureOf(answer));
          return;
        }
        setFailure({ requestId, shown: answer.error === 'busy' ? { error: 'busy' } : actFailureOf(answer) });
        if (answer.error === 'wrong_state') await readAgain();
      } catch {
        await settleLostAnswer(requestId, UNCONFIRMED_WRITE);
      } finally {
        setSubmittingId(null);
        setAskingId(null);
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
    ask: (requestId) => {
      setFailure(null);
      setAskingId(requestId);
    },
    dismiss: () => setAskingId(null),
    confirm,
  };
}
