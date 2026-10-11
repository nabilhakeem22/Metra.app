import 'server-only';
// The client acknowledges the budget band on the portal: the write, then the
// studio's notification. Two entry points: the first half of "approve the
// design and the budget in one confirmation" (./design-acts.ts), and the budget
// card's own button, which answers from the acknowledgement ON FILE when the
// write saved nothing (fix round F1, F7).
//
// Both name the band issuance the client SAW (Round D): the seven-argument
// write refuses it with `wrong_state` once another band is issued, under its
// row lock. There is no read before the write.
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import { answersFromSaved, type BudgetOutcome } from '../review-outcome';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type BudgetInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action' | 'expectedIssueAt'>;

/**
 * Acknowledge the band issuance the client saw (`romIssuedAt`). Idempotent
 * (`already` is ok). A first `ok` notifies the studio; a repeat notifies only
 * if that notification was lost. Another band issued since: `wrong_state`.
 */
export async function acknowledgeBudgetAndNotify(
  rawToken: string,
  input: BudgetInput,
  romIssuedAt: string,
): Promise<DeliveryActionResult & { studioNotified: boolean }> {
  const result = await recordDeliveryActionByToken(rawToken, {
    ...input,
    action: 'acknowledge_rom',
    expectedIssueAt: romIssuedAt,
  });
  return withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
}

/**
 * The budget card's button: acknowledge the band issuance the card SHOWED. A
 * tap that saved nothing (a repeat, a band re-issued or withdrawn since) is
 * answered from the acknowledgement on file, and only when it is of that same
 * issuance; otherwise it reads `changed`, and the page re-reads.
 */
export async function acknowledgeSeenBudgetAndNotify(
  rawToken: string,
  input: BudgetInput,
  bandSeen: string,
): Promise<BudgetOutcome> {
  const result = await recordDeliveryActionByToken(rawToken, {
    ...input,
    action: 'acknowledge_rom',
    expectedIssueAt: bandSeen,
  });
  if (answersFromSaved(result)) {
    const saved = await savedDelivery(rawToken);
    if (!saved?.romAcknowledgedAt || saved.rom?.issuedAt !== bandSeen) return { kind: 'changed' };
    const { studioNotified } = await withStudioNotified(rawToken, { ok: true, code: 'already' as const }, { kind: 'budget_acknowledged' });
    return { kind: 'acknowledged', studioNotified };
  }
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
  return { kind: 'acknowledged', studioNotified };
}
