import 'server-only';
// The client acknowledges the budget range on the portal: the write, then the
// studio's notification (Round C: its own typed action, and the second half of
// "approve the design and the budget in one confirmation").
import { recordDeliveryActionByToken, type DeliveryActionResult } from '../public';
import { withStudioNotified } from './notify';

type BudgetInput = Omit<Parameters<typeof recordDeliveryActionByToken>[1], 'action'>;

/**
 * Acknowledge the band issued NOW. Idempotent (`already` is ok). A first `ok`
 * notifies the studio; a repeat notifies only if that notification was lost.
 */
export async function acknowledgeBudgetAndNotify(
  rawToken: string,
  input: BudgetInput,
): Promise<DeliveryActionResult & { studioNotified: boolean }> {
  const result = await recordDeliveryActionByToken(rawToken, { ...input, action: 'acknowledge_rom' });
  return withStudioNotified(rawToken, result, { kind: 'budget_acknowledged' });
}
