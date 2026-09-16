// Design-Engagement Machine — the edges that LEAVE the proposal_survey phase
// (`created`, `design_proposal`, `survey`; see phases.ts). A trigger is filed by
// the phase of its SOURCE state, so this is the machine's opening: scope in, fee
// out, deposit cleared, site measured. PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const PROPOSAL_SURVEY_EDGES = {
  submitDesignFee: {
    from: 'created',
    to: 'design_proposal',
    guards: ['scopeInputsPresent'],
    sideEffect: 'generateFeeSchedule',
    capability: 'engagements_design',
  },
  confirmAndPayDeposit: {
    from: 'design_proposal',
    to: 'survey',
    guards: ['depositCleared'],
    sideEffect: 'activateOnDeposit',
    capability: 'engagements_finance',
  },
  spatialBaseReady: {
    from: 'survey',
    to: 'layout',
    guards: ['spatialBaseReady'],
    sideEffect: null,
    capability: 'engagements_design',
  },
} satisfies Record<string, TransitionDef>;
