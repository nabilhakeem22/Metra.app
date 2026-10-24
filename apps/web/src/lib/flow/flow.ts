// Which phases a flow runs through, and which one a delivery is in. PURE and
// CLIENT-SAFE. Keyed by the flow registry (lib/entitlements/flows.ts), so a new
// vertical does not compile until it says which phases it has.
import type { Flow } from '@/lib/entitlements/flows';
import type { DesignState } from '@/lib/engagements/states';
import type { EntryPhase, PhaseKey } from './types';

export const FLOW_PHASES: Readonly<Record<Flow, readonly PhaseKey[]>> = {
  interior: ['design', 'execution'],
};

/** The phases a delivery goes through: the flow's, from the phase it entered at. */
export function phasesOf(flow: Flow, entry: EntryPhase): readonly PhaseKey[] {
  const phases = FLOW_PHASES[flow];
  const start = phases.indexOf(entry);
  // developer-only: the message carries a flow key and a phase key, never a person's data.
  if (start < 0) throw new Error(`flow ${flow} has no ${entry} phase`);
  return phases.slice(start);
}

/**
 * The phase a delivery is in now. The design machine ends at `execution`, and a
 * delivery that entered at execution is only ever in that state, so the state
 * alone decides.
 */
export function currentPhaseOf(state: DesignState): PhaseKey {
  return state === 'execution' ? 'execution' : 'design';
}
