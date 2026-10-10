import 'server-only';
// The client acknowledges the budget band on the portal: the write, then the
// studio's notification. Two entry points: the second half of "approve the
// design and the budget in one confirmation" (./design-acts.ts, which checks
// what was seen itself), and the budget card's own button, which checks the
// band it showed and answers from the acknowledgement ON FILE when the write
// saved nothing (fix round F1, F7).
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import { answersFromSaved, type BudgetOutcome } from '../review-outcome';
import { withStudioNotified } from './notify';
import { stillAsSeen } from './review-seen-check';
import { savedDelivery } from './saved-delivery';

type BudgetInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/**
 * Acknowledge the band issued NOW. Idempotent (`already` is ok). A first `ok`
 * notifies the studio; a repeat notifies only if that notification was lost.
 * The caller has already checked that this is the band the client saw.
 */
export async function acknowledgeBudgetAndNotify(
  rawToken: string,
  input: BudgetInput,
): Promise<DeliveryActionResult & { studioNotified: boolean }> {
  const result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_rom' });
  return withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
}

/**
 * The budget card's button: acknowledge the band the card SHOWED (`changed`,
 * nothing written, when another band is issued now). A tap that saved nothing
 * (a repeat, a delivery since closed) is answered from the acknowledgement on
 * file; with none on file it reads `changed`, and the page re-reads.
 */
export async function acknowledgeSeenBudgetAndNotify(
  rawToken: string,
  input: BudgetInput,
  bandSeen: string,
): Promise<BudgetOutcome> {
  if (!(await stillAsSeen(rawToken, { band: bandSeen }))) return { kind: 'changed' };
  const result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_rom' });
  if (answersFromSaved(result)) {
    const saved = await savedDelivery(rawToken);
    if (!saved?.romAcknowledgedAt) return { kind: 'changed' };
    const { studioNotified } = await withStudioNotified(rawToken, { ok: true, code: 'already' as const }, { kind: 'budget_acknowledged' });
    return { kind: 'acknowledged', studioNotified };
  }
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
  return { kind: 'acknowledged', studioNotified };
}
