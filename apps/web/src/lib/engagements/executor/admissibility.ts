// Design-Engagement Machine — transition ADMISSIBILITY (wave 4, extracted from
// `executor.ts` verbatim). PURE: no tx, no ctx, no I/O. These are the questions
// that can be answered from the edge definition and the engagement's current
// state alone, so they are unit-testable without a database.
import { fail } from '@/lib/actions/result';
import type { DesignState } from '../states';
import type { TransitionDef } from '../transitions';

/** The edge's legal `from` states, normalised — `from` may be one or many. */
export function legalFromStates(def: TransitionDef): DesignState[] {
  return Array.isArray(def.from) ? def.from : [def.from];
}

/**
 * A self-loop edge: its target IS one of its legal from-states.
 *
 * PER DEFINITION, not per firing. attestAsBuiltClean declares
 * `from: ['final_approval', 'change_triage']` and `to: 'final_approval'`, so
 * this is true even when the edge actually being fired is the ADVANCING
 * change_triage -> final_approval one, and that firing stores a key too.
 * Deliberately harmless: the advancing edge has its own state gate as well, and
 * since 0050 the key is scoped to the trigger, so the only thing an extra stored
 * key can ever collapse is a retry of THIS verb — which is what it is for.
 */
export function isSelfLoop(def: TransitionDef): boolean {
  return legalFromStates(def).includes(def.to);
}

/**
 * Assert the engagement's current state is a legal `from` for this edge.
 *
 * `fail('illegal_trigger')` when it is not — NO ledger write and NO state
 * change, because this runs before the admission gate. Checked after the replay
 * short-circuit and before any guard, exactly as it was in the single function.
 */
export function validateLegalFrom(
  def: TransitionDef,
  state: DesignState,
): void {
  if (!legalFromStates(def).includes(state)) fail('illegal_trigger');
}
