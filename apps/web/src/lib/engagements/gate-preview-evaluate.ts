// Design-Engagement Machine — the gate preview's PURE evaluation. Given the fact
// bundle the executor loads, it resolves the forward trigger (or, at a choice
// state, the endings) and re-runs that trigger's guards one by one so the cockpit
// can render a machine-truthful checklist. NOT server-only: the single-engagement
// read (`gate-preview.ts`) and the batch whose-move loader both call it, so the
// cockpit, the list and the dashboard cannot disagree about the same delivery.
// Never imported by a client file: it pulls the whole guard engine.
import type { ActionCode } from '@/lib/actions/result';
import { formatMoney4 } from '@/lib/aggregates/proposal-totals';
import { endingChoicesFrom, resolveForwardTrigger } from './forward-trigger';
import {
  GUARDS,
  MONEY_GUARD_MILESTONE,
  milestoneShortfall4,
  type GuardFacts,
  type GuardKey,
} from './guards';
import { TRANSITIONS, type Trigger } from './transitions';

/** One guard of the forward trigger, evaluated individually for the hero. */
export interface GateChecklistItem {
  guard: GuardKey;
  ok: boolean;
  /** The failing guard's coded reason, or null when the guard passes. */
  code: ActionCode | null;
  /** The milestone shortfall (scale-4 string) for a BLOCKING payment gate, else null. */
  amountDue: string | null;
}

/** The hero's view of "what's next": the forward trigger + its guard checklist. */
export interface EngagementGatePreview {
  /** The one auto-fireable forward trigger; null at a choice state. */
  primaryTrigger: Trigger | null;
  /** The endings the studio must pick between explicitly (`execution_decision` only). */
  endingChoices: Trigger[];
  /** The guards of `primaryTrigger`, else of the first ending (all endings share them). */
  items: GateChecklistItem[];
  allClear: boolean;
}

/** The preview of an engagement that is absent or has nowhere to go. */
export const EMPTY_GATE_PREVIEW: EngagementGatePreview = {
  primaryTrigger: null,
  endingChoices: [],
  items: [],
  allClear: true,
};

function evaluateGuard(facts: GuardFacts, guard: GuardKey): GateChecklistItem {
  const verdict = GUARDS[guard](facts);
  const milestoneKind = MONEY_GUARD_MILESTONE[guard];
  let amountDue: string | null = null;
  if (!verdict.ok && milestoneKind) {
    const shortfall = milestoneShortfall4(facts, milestoneKind);
    if (shortfall > 0n) amountDue = formatMoney4(shortfall);
  }
  return { guard, ok: verdict.ok, code: verdict.ok ? null : verdict.code, amountDue };
}

/**
 * Evaluate the gate for the engagement in `facts`. A blocking PAYMENT guard
 * carries the `milestoneShortfall4` amount due; other guards carry null.
 */
export function evaluateGatePreview(facts: GuardFacts): EngagementGatePreview {
  const state = facts.engagement.state;
  const primaryTrigger = resolveForwardTrigger(state);
  const endingChoices = endingChoicesFrom(state);
  const checkedTrigger = primaryTrigger ?? endingChoices[0] ?? null;
  if (checkedTrigger === null) return { ...EMPTY_GATE_PREVIEW };

  const items = TRANSITIONS[checkedTrigger].guards.map((guard) =>
    evaluateGuard(facts, guard),
  );
  return {
    primaryTrigger,
    endingChoices,
    items,
    allClear: items.every((item) => item.ok),
  };
}
