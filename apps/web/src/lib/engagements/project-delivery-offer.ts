// What a project's delivery panel offers. PURE and CLIENT-SAFE (the panel is a
// client component; the create guard in ./delivery-slot.ts is the same rule).
import type { EntryPhase } from '@/lib/flow/types';
import { isTerminal, type DesignState } from './states';

export interface ProjectDeliveryOffer {
  /**
   * What the panel calls the delivery it shows: a design delivery, or the
   * client page of an execution contract (a LIGHT delivery, ruling D14), which
   * is no design delivery at all.
   */
  heading: 'heading' | 'lightHeading';
  /** The create button, or none when the project's client has a delivery to continue from. */
  create: 'start' | null;
}

/**
 * The panel's offer from the delivery it shows (active, else newest non-abandoned,
 * else newest) and the project's client. A client on a project has one delivery,
 * so `start` only with none, with an abandoned one, or beside a finished delivery
 * of ANOTHER client (the project's client changed).
 */
export function projectDeliveryOffer(
  delivery: { state: DesignState; entryPhase: EntryPhase; clientId: string } | null,
  projectClientId: string,
): ProjectDeliveryOffer {
  const heading = delivery?.entryPhase === 'execution' ? 'lightHeading' : 'heading';
  if (!delivery || delivery.state === 'abandoned') return { heading, create: 'start' };
  return { heading, create: isTerminal(delivery.state) && delivery.clientId !== projectClientId ? 'start' : null };
}
