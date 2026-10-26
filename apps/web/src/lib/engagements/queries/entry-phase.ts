import type { EntryPhase } from '@/lib/flow/types';

/**
 * A delivery's entry phase as `design_engagements.entry_phase` holds it: a
 * text column the database CHECKs to the two phases, so anything but
 * 'execution' is a design delivery.
 */
export function entryPhaseOf(column: string): EntryPhase {
  return column === 'execution' ? 'execution' : 'design';
}
