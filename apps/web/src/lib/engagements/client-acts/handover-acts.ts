import 'server-only';
// The client confirms receiving the design package (Round C, carry-over 5): the
// write, the studio's notification, and the answer the portal shows
// (../review-outcome.ts). A tap that saved nothing (a repeat, a delivery the
// studio already closed) is answered from the confirmation ON FILE; with none on
// file, `moved_on` only when the delivery left the handover stage.
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import { answersFromSaved, handoverOutcomeOfSaved, type HandoverOutcome } from '../review-outcome';
import { withHandoverClose } from './handover-close';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type HandoverInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/** Notify and answer one handover write: the confirmation SAVED, or why there is none. */
async function answerOfHandoverWrite(rawToken: string, result: DeliveryActionResult): Promise<HandoverOutcome> {
  if (answersFromSaved(result)) {
    const saved = await savedDelivery(rawToken);
    if (!saved?.handoverAcknowledgedAt) return handoverOutcomeOfSaved(saved, false);
    const { studioNotified } = await withStudioNotified(
      rawToken,
      { ok: true, code: 'already' as const },
      { kind: 'handover_acknowledged' },
    );
    return handoverOutcomeOfSaved(saved, studioNotified);
  }
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'handover_acknowledged' });
  return { kind: 'acknowledged', studioNotified };
}

/**
 * Confirm the handover, then notify and answer with what is SAVED while the
 * design-only delivery closes in this request (C11, ./handover-close.ts: for
 * every `ok` write, a first one and `already`, so a repeat repairs a close that
 * failed; the answer waits at most HANDOVER_CLOSE_WAIT_MS for it, and the
 * hourly closer stays the safety net). The close never changes the answer.
 */
export async function acknowledgeHandoverAndNotify(rawToken: string, input: HandoverInput): Promise<HandoverOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_handoff' });
  return withHandoverClose(rawToken, 'acknowledge_handoff', result, () => answerOfHandoverWrite(rawToken, result));
}
