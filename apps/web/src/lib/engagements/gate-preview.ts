// Design-Engagement Machine — the Hero "next action" gate preview (Epic D,
// Slice 3). SERVER-ONLY read-model: it loads the SAME facts the executor loads
// for the engagement's current state, resolves the single forward-advance trigger,
// then re-runs each of that trigger's guards through the pure guard engine so the
// cockpit hero can render a MACHINE-TRUTHFUL checklist (one row per guard, with the
// milestone shortfall as the amount due). It NEVER mutates and NEVER re-implements
// guard logic or money math — it reuses `GUARDS` + `milestoneShortfall4`.
import 'server-only';
import {
  designEngagements,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  paymentEvents,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import type { ActionCode } from '@/lib/actions/result';
import { formatMoney4 } from '@/lib/aggregates/proposal-totals';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import {
  GUARDS,
  MONEY_GUARD_MILESTONE,
  milestoneShortfall4,
  type GuardFacts,
  type GuardKey,
} from './guards';
import { STAGE_NUMBER, type DesignState } from './states';
import { TRANSITIONS, type Trigger } from './transitions';
import { legalTriggersFrom } from './ui';

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
  primaryTrigger: Trigger | null;
  items: GateChecklistItem[];
  allClear: boolean;
}

// rejectDesign (bounce back) and abandon (off-ramp) are legal from many states but
// are NOT the forward advance — the hero never proposes them as "what's next".
const NON_FORWARD_TRIGGERS = new Set<Trigger>(['rejectDesign', 'abandon']);

/**
 * The single forward-advance trigger from `state`: the wired, legal trigger (via
 * `legalTriggersFrom`) — excluding the non-forward rejectDesign/abandon — whose
 * destination sits FURTHEST along the funnel (highest `STAGE_NUMBER` of its `to`).
 * Picking the furthest destination naturally selects `confirmConcept` over the
 * `requestRevision` self-loop, `approveDesign` over the `flagAsBuiltVariance`
 * detour, and the change_triage reconciliation back to final_approval — while a
 * terminal (or not-yet-wired) state yields null. Ties resolve to registry order.
 */
export function resolveForwardTrigger(state: DesignState): Trigger | null {
  const candidates = legalTriggersFrom(state).filter(
    (trigger) => !NON_FORWARD_TRIGGERS.has(trigger),
  );
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestStage = STAGE_NUMBER[TRANSITIONS[best].to];
  for (const trigger of candidates) {
    const stage = STAGE_NUMBER[TRANSITIONS[trigger].to];
    if (stage > bestStage) {
      best = trigger;
      bestStage = stage;
    }
  }
  return best;
}

/**
 * Build the gate preview for one engagement. Loads the engagement (RLS-scoped:
 * a foreign/absent id yields an empty, all-clear preview), resolves the forward
 * trigger, loads the same fact bundle the executor gathers, then evaluates each
 * of the trigger's guards individually. A blocking PAYMENT guard carries the
 * `milestoneShortfall4` amount due (scale-4 string); other guards carry null.
 * The CALLER gates the read on the `engagements_design` read capability; RLS is
 * the second factor. No mutation, no state change.
 */
export function getEngagementGatePreview(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementGatePreview> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select()
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);
    if (!engagement) {
      return { primaryTrigger: null, items: [], allClear: true };
    }

    const primaryTrigger = resolveForwardTrigger(engagement.state);
    if (!primaryTrigger) {
      return { primaryTrigger: null, items: [], allClear: true };
    }

    // The same facts the executor pre-loads for a guard run (sequential on the
    // single tx, mirroring executor.ts — no parallel queries on one connection).
    const milestones = await tx
      .select()
      .from(engagementMilestones)
      .where(eq(engagementMilestones.engagementId, engagementId));
    const payments = await tx
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.engagementId, engagementId));
    const artifacts = await tx
      .select()
      .from(engagementArtifacts)
      .where(eq(engagementArtifacts.engagementId, engagementId));
    const changeOrders = await tx
      .select()
      .from(engagementChangeOrders)
      .where(eq(engagementChangeOrders.engagementId, engagementId));
    const events = await tx
      .select()
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId));

    const facts: GuardFacts = {
      engagement,
      milestones,
      payments,
      artifacts,
      changeOrders,
      events,
    };

    const items: GateChecklistItem[] = TRANSITIONS[primaryTrigger].guards.map(
      (guard) => {
        const verdict = GUARDS[guard](facts);
        const milestoneKind = MONEY_GUARD_MILESTONE[guard];
        let amountDue: string | null = null;
        if (!verdict.ok && milestoneKind) {
          const shortfall = milestoneShortfall4(facts, milestoneKind);
          if (shortfall > 0n) amountDue = formatMoney4(shortfall);
        }
        return {
          guard,
          ok: verdict.ok,
          code: verdict.ok ? null : verdict.code,
          amountDue,
        };
      },
    );

    return {
      primaryTrigger,
      items,
      allClear: items.every((item) => item.ok),
    };
  });
}
