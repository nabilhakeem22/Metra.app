// Would confirming this client claim, for this amount, move the delivery on?
// PURE and CLIENT-SAFE (leaf imports only), read by the command card to put a
// confirm dialog in front of the one click that both records money and changes
// the stage. The server decides for real (confirm-claim-and-advance.ts); this
// only decides whether to ASK first, by the same rule over the gate preview.
import type { MilestoneKind } from '@metra/db';
import { isMoneyString, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { EngagementGatePreview } from './gate-preview';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from './guards/trigger-money-gate';
import type { DesignState } from './states';
import { TRANSITIONS } from './transitions';

/**
 * The state the delivery would move to, or null when the confirm only records
 * the payment: the claim does not pay the forward gate, another guard is still
 * unmet, the amount is short of what is due, the role may not advance, or the
 * client has not answered the review round yet (the server holds the move too).
 */
export function claimAdvancesTo(
  preview: Pick<EngagementGatePreview, 'primaryTrigger' | 'items' | 'awaitingClientReview'>,
  milestoneKind: MilestoneKind,
  amount: string,
  canAdvance: boolean,
): DesignState | null {
  const trigger = preview.primaryTrigger;
  if (!trigger || !canAdvance || preview.awaitingClientReview) return null;
  const moneyGuard = moneyGuardOf(trigger);
  if (!moneyGuard || MONEY_GUARD_MILESTONE[moneyGuard] !== milestoneKind) return null;
  if (preview.items.some((item) => item.guard !== moneyGuard && !item.ok)) return null;
  const due = preview.items.find((item) => item.guard === moneyGuard)?.amountDue ?? null;
  const typed = amount.trim();
  if (!isMoneyString(typed) || parseMoney4(typed) < parseMoney4(due)) return null;
  return TRANSITIONS[trigger].to;
}
