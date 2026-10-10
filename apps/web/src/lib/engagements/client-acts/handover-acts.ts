import 'server-only';
// The client confirms receiving the design package (Round C, carry-over 5): the
// write, the studio's notification, and the answer the portal shows
// (../review-outcome.ts). A tap that saved nothing (a repeat, a delivery the
// studio already closed) is answered from the confirmation ON FILE.
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken } from '../public';
import { answersFromSaved, handoverOutcomeOfSaved, type HandoverOutcome } from '../review-outcome';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type HandoverInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/** Confirm the handover, then notify and answer with what is SAVED. */
export async function acknowledgeHandoverAndNotify(rawToken: string, input: HandoverInput): Promise<HandoverOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_handoff' });
  if (answersFromSaved(result)) {
    const saved = await savedDelivery(rawToken);
    if (!saved?.handoverAcknowledgedAt) return { kind: 'moved_on' };
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
