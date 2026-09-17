// Design-Engagement Machine — the guard pass (wave 4, extracted from
// `executor.ts` verbatim). PURE: guards never take a `tx` and never do I/O, so
// running them is pure too — every fact was loaded by `facts.ts` first.
import { fail } from '@/lib/actions/result';
import { GUARDS, type GuardFacts } from '../guards';
import type { TransitionDef } from '../transitions';

/**
 * Run the edge's guards IN ORDER and `fail(verdict.code)` on the FIRST refusal.
 *
 * Order matters and is the registry's to choose: the first guard to refuse is
 * the reason the studio is shown, so the cheapest/most explanatory gate is
 * listed first. A refusal throws, which rolls the surrounding transaction back
 * before the admission gate — no state move, no side-effect, no ledger row.
 */
export function validateGuards(def: TransitionDef, facts: GuardFacts): void {
  for (const guardKey of def.guards) {
    const verdict = GUARDS[guardKey](facts);
    if (!verdict.ok) fail(verdict.code);
  }
}
