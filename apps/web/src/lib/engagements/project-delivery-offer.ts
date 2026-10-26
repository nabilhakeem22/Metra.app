// What a project's delivery panel offers. PURE and CLIENT-SAFE (the panel is a
// client component; the create guard in ./delivery-slot.ts shares the cap).
import type { EntryPhase } from '@/lib/flow/types';
import { isTerminal, type DesignState } from './states';

/**
 * Lifetime cap: a Project may hold at most TWO counted deliveries over its life
 * (the original + one extension). Abandoned and light deliveries are not
 * counted (./delivery-slot.ts, deliveriesCountedTowardCap).
 */
export const PROJECT_DELIVERY_CAP = 2;

export interface ProjectDeliveryOffer {
  /**
   * What the panel calls the delivery it shows: a design delivery, or the
   * client page of an execution contract (a LIGHT delivery, ruling D14), which
   * is no design delivery at all.
   */
  heading: 'heading' | 'lightHeading';
  /**
   * The create button: the project's first counted delivery (`start`), its
   * ONE extension once a counted one exists (`extend`), or none while a
   * delivery is in flight or the cap is used.
   */
  create: 'start' | 'extend' | null;
  /** The cap is used: no delivery can start on this project any more. */
  atLimit: boolean;
}

/**
 * The panel's offer from the delivery it shows (the active one, else the
 * newest) and the project's COUNTED deliveries. A light delivery is not
 * counted, so the first design delivery after it is a start, never an
 * extension.
 */
export function projectDeliveryOffer(
  delivery: { state: DesignState; entryPhase: EntryPhase } | null,
  countedDeliveries: number,
): ProjectDeliveryOffer {
  const heading = delivery?.entryPhase === 'execution' ? 'lightHeading' : 'heading';
  if (delivery && !isTerminal(delivery.state)) return { heading, create: null, atLimit: false };
  if (countedDeliveries >= PROJECT_DELIVERY_CAP) return { heading, create: null, atLimit: true };
  return { heading, create: countedDeliveries === 0 ? 'start' : 'extend', atLimit: false };
}
