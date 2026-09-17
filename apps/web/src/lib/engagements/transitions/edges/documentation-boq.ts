// Design-Engagement Machine — the edges that LEAVE the documentation_boq phase
// (`shop_drawings`, `boq`; see phases.ts). A trigger is filed by the phase of its
// SOURCE state. PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const DOCUMENTATION_BOQ_EDGES = {
  // Tail wiring: the drafted shop drawings open the BOQ stage. Pure state move —
  // recording a `shop_drawing` artifact IS the attested deliverable.
  draftReady: {
    from: 'shop_drawings',
    to: 'boq',
    guards: ['shopDrawingsPresent'],
    sideEffect: null,
    capability: 'engagements_design',
  },
  // Tail wiring: a recorded BOQ artifact closes documentation and opens the
  // execution decision. Finance family — the BOQ is priced work.
  finalizeBOQ: {
    from: 'boq',
    to: 'execution_decision',
    guards: ['boqPresent'],
    sideEffect: null,
    capability: 'engagements_finance',
  },
} satisfies Record<string, TransitionDef>;
