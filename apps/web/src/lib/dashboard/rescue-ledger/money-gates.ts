// The money gates R4 counts, DERIVED from the transition registry and never
// listed by hand. PURE and CLIENT-SAFE (it reads static data only).
//
// A money gate is every trigger whose guard list carries a milestone money
// guard (`moneyGuardOf`); its gate state is the state it leaves, and its
// milestone is the one that guard clears. A new money edge is picked up here
// without anyone remembering to add it.
import type { MilestoneKind } from '@metra/db';
import { MONEY_GUARD_MILESTONE, moneyGuardOf } from '@/lib/engagements/guards/trigger-money-gate';
import type { DesignState } from '@/lib/engagements/states';
import { TRANSITIONS, type Trigger } from '@/lib/engagements/transitions';

export interface MoneyGate {
  trigger: Trigger;
  /** The state the delivery waits in while the stage fee is due. */
  gateState: DesignState;
  /** The milestone (and payment) kind the gate's guard clears. */
  milestoneKind: MilestoneKind;
}

function deriveMoneyGates(): MoneyGate[] {
  const gates: MoneyGate[] = [];
  for (const trigger of Object.keys(TRANSITIONS) as Trigger[]) {
    const guard = moneyGuardOf(trigger);
    const milestoneKind = guard ? MONEY_GUARD_MILESTONE[guard] : undefined;
    if (!milestoneKind) continue;
    const from = TRANSITIONS[trigger].from;
    for (const gateState of Array.isArray(from) ? from : [from]) {
      gates.push({ trigger, gateState, milestoneKind });
    }
  }
  return gates;
}

export const MONEY_GATES: readonly MoneyGate[] = Object.freeze(deriveMoneyGates());
