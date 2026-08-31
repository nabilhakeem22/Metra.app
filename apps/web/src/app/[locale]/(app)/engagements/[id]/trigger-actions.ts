// Payload-free lifecycle triggers -> their server action. Shared by the
// next-actions list AND the hero's direct-advance CTA so the mapping lives in one
// place (the three payload triggers — submitDesignFee, requestRevision,
// designChangeRaised — open a form instead and are deliberately absent). A plain
// module (no 'use client'): it just
// re-exports the 'use server' action references, so either a client or a server
// component may import the map without a boundary breach.
import type { ActionResult } from '@/lib/actions/result';
import {
  abandonEngagement,
  approveDesign,
  attestAsBuiltClean,
  chooseDesignOnly,
  chooseExecution,
  confirmAndPayDeposit,
  confirmConcept,
  draftReady,
  finalizeBOQ,
  flagAsBuiltVariance,
  optionsReady,
  recipientAcknowledges,
  rejectDesign,
  rendersReady,
  selectConcept,
  spatialBaseReady,
} from '@/lib/engagements/actions';
import type { Trigger } from '@/lib/engagements/transitions';

export const DIRECT_TRIGGER_ACTIONS: Partial<
  Record<Trigger, (engagementId: string) => Promise<ActionResult>>
> = {
  confirmAndPayDeposit,
  spatialBaseReady,
  optionsReady,
  selectConcept,
  confirmConcept,
  rendersReady,
  flagAsBuiltVariance,
  attestAsBuiltClean,
  approveDesign,
  rejectDesign,
  draftReady,
  finalizeBOQ,
  chooseDesignOnly,
  chooseExecution,
  recipientAcknowledges,
  abandon: abandonEngagement,
};
