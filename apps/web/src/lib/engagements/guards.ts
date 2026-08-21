// Design-Engagement Machine — guard engine (Step 2). PURE and CLIENT-SAFE:
// guards are total predicates over a pre-loaded facts bundle. A guard NEVER
// takes a `tx`, does I/O, or touches the DB — the executor gathers every fact
// first, then guards only decide. The only runtime dependency is the type-level
// `DesignEngagement` (erased). Later steps WIDEN `GuardFacts` (payments,
// artifacts, revision counters) without changing this contract.
import type { DesignEngagement } from '@metra/db';
import type { ActionCode } from '@/lib/actions/result';

/** The facts a guard may read. Slice-1 carries only the engagement row. */
export interface GuardFacts {
  engagement: DesignEngagement;
}

/** A guard's verdict: pass, or fail with the coded reason to surface. */
export type GuardResult = { ok: true } | { ok: false; code: ActionCode };

/** Guard identifiers referenced by the transition registry. */
export type GuardKey = 'scopeInputsPresent' | 'pendingGuard';

const pass: GuardResult = { ok: true };

/**
 * The engagement's scope is complete enough to be shown to a client: a bilingual
 * title (Arabic OR English present) plus a resolved client and project. This is
 * the gate for `submitDesignFee` — you cannot put a fee in front of a client on
 * an unnamed, unassigned job.
 */
function scopeInputsPresent(facts: GuardFacts): GuardResult {
  const { titleAr, titleEn, clientId, projectId } = facts.engagement;
  const hasTitle = Boolean(titleAr?.trim()) || Boolean(titleEn?.trim());
  if (!hasTitle || !clientId || !projectId) {
    return { ok: false, code: 'guard_scope_inputs_missing' };
  }
  return pass;
}

/**
 * Fail-closed sentinel for triggers whose real guard belongs to a later step.
 * It always denies with `transition_not_yet_enabled`, so a declared-but-unwired
 * transition can never fire early. Replaced by concrete guards in Steps 3–4.
 */
function pendingGuard(): GuardResult {
  return { ok: false, code: 'transition_not_yet_enabled' };
}

/** The guard registry — the executor resolves a GuardKey to its predicate here. */
export const GUARDS: Record<GuardKey, (facts: GuardFacts) => GuardResult> = {
  scopeInputsPresent,
  pendingGuard,
};
