// The one-action-never-a-menu button set per hero group. PURE (no React): the
// action hero renders it and a unit test can read it.
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import type { HeroOutcome } from './hero-confirmed';

export interface HeroButton {
  verb: string;
  /** Key under `delivery.hero.<group>` for the button label. */
  labelKey: 'approve' | 'changes' | 'acknowledge';
  outcome: HeroOutcome;
  variant: 'default' | 'ghost';
  /** Asks "are you sure?" first: approving and confirming the handover cannot
   *  be taken back from this page. A request for changes needs a note instead. */
  confirms: boolean;
}

/**
 * A single primary CTA with a quiet "request changes" beside it (handoff has
 * only the confirm). The verbs are the SDF-computed client-action tokens;
 * recording either of a concept/design pair drops BOTH from the next read
 * (server-side), so confirming one ends the group.
 */
export const GROUP_BUTTONS: Record<HeroGroup, HeroButton[]> = {
  concept: [
    { verb: 'approve_concept', labelKey: 'approve', outcome: 'approved', variant: 'default', confirms: true },
    { verb: 'request_concept_changes', labelKey: 'changes', outcome: 'changes', variant: 'ghost', confirms: false },
  ],
  design: [
    { verb: 'approve_design', labelKey: 'approve', outcome: 'approved', variant: 'default', confirms: true },
    { verb: 'request_design_changes', labelKey: 'changes', outcome: 'changes', variant: 'ghost', confirms: false },
  ],
  handoff: [
    { verb: 'acknowledge_handoff', labelKey: 'acknowledge', outcome: 'acknowledged', variant: 'default', confirms: true },
  ],
};
