import 'server-only';
// The client acknowledges the budget band on the portal: the write, then the
// studio's notification. Two entry points: the first half of "approve the
// design and the budget in one confirmation" (./design-acts.ts), and the budget
// card's own button. Both answer from the acknowledgement ON FILE when the
// write saved nothing (fix round F1, F7; D3 F3).
//
// Both name the band issuance the client SAW (Round D): the seven-argument
// write refuses it with `wrong_state` once another band is issued, under its
// row lock. There is no read before the write.
import { portalActFailure } from '@/lib/share/portal-act-failure';
import type { PortalFailure } from '@/lib/share/portal-act-failure';
import { portalErrorKey } from '../portal-error-key';
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import { answersFromSaved, type BudgetOutcome, type BudgetPart } from '../review-outcome';
import { withStudioNotified } from './notify';
import { savedDelivery } from './saved-delivery';

type BudgetInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action' | 'expectedIssueAt'>;

/** The budget half of the one-tap approve+budget, or why the tap stops before the design. */
export type BudgetHalf = { budget: BudgetPart } | { stop: PortalFailure | { error: 'token_invalid' | 'token_expired' } };

/**
 * The acknowledgement ON FILE of the band issuance the client saw, notified
 * through the R3 check (a lost first notification is repaired), or null when
 * none is on file for that band (another band is issued, none at all, or the
 * delivery cannot be read).
 */
async function acknowledgementOnFile(rawToken: string, bandSeen: string): Promise<{ studioNotified: boolean } | null> {
  const saved = await savedDelivery(rawToken);
  if (!saved?.romAcknowledgedAt || saved.rom?.issuedAt !== bandSeen) return null;
  return withStudioNotified(rawToken, { ok: true, code: 'already' as const }, { kind: 'budget_acknowledged' });
}

/**
 * The first half of approve+budget: acknowledge the band issuance the client
 * saw (`romIssuedAt`).
 * - ok or already: acknowledged, the studio notified (once).
 * - wrong_state: changed (another band is issued, or none).
 * - a dead or expired link: stop; the design write would fail the same way.
 * - a write that THREW: stop. It may still commit (a write deadline is
 *   uncertain), so the design is never sent on top of an unknown budget, and
 *   no second write queues behind a stalled row lock (D3 R2).
 * - any other refusal (a delivery that ended): what is on file for that band.
 */
export async function acknowledgeBudgetHalf(rawToken: string, input: BudgetInput, romIssuedAt: string): Promise<BudgetHalf> {
  let result: DeliveryActionResult;
  try {
    result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_rom', expectedIssueAt: romIssuedAt });
  } catch (error) {
    return { stop: portalActFailure('approveDesignWithBudget: the budget half', error) };
  }
  if (result.ok) {
    await withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
    return { budget: 'acknowledged' };
  }
  if (result.error === 'token_invalid' || result.error === 'token_expired') return { stop: { error: result.error } };
  if (result.error === 'wrong_state') return { budget: 'changed' };
  return { budget: (await acknowledgementOnFile(rawToken, romIssuedAt)) ? 'acknowledged' : 'failed' };
}

/**
 * The budget card's button: acknowledge the band issuance the card SHOWED. A
 * tap that saved nothing (a repeat, a band re-issued or withdrawn since, a
 * delivery that ended) is answered from the acknowledgement on file of that
 * same issuance; with none, it reads `changed`, and the page re-reads.
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
    const onFile = await acknowledgementOnFile(rawToken, bandSeen);
    return onFile ? { kind: 'acknowledged', studioNotified: onFile.studioNotified } : { kind: 'changed' };
  }
  if (!result.ok) return { kind: 'error', error: portalErrorKey(result.error) };
  const { studioNotified } = await withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
  return { kind: 'acknowledged', studioNotified };
}
