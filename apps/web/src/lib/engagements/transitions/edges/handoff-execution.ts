// Design-Engagement Machine — the edges that LEAVE the handoff_execution phase
// (`execution_decision`, `design_only_handoff`, `closed_design_only`; see phases.ts).
// A trigger is filed by the phase of its SOURCE state. These are the two endings,
// the acknowledgement that closes the design-only one, and the way a closed
// design-only delivery goes on to execution. PURE, CLIENT-SAFE DATA.
import { ENDING_DECIDERS } from '../trigger-roles';
import type { TransitionDef } from '../types';

export const HANDOFF_EXECUTION_EDGES = {
  // Tail wiring (owner-locked): the BALANCE gates BOTH execution-decision exits —
  // the final installment clears before either ending. Only an owner, admin or
  // project manager may choose either ending (owner decision, Oct 6).
  // Client Deliverables (Step 1): the design-only handover releases the shop
  // drawings to the portal. The BOQ is NOT part of this package — it stays
  // manual-only (it can carry the firm's own rates).
  chooseDesignOnly: {
    from: 'execution_decision',
    to: 'design_only_handoff',
    guards: ['balanceCleared'],
    sideEffect: null,
    capability: 'engagements_design',
    clientRelease: 'handoverPackage',
    decidedBy: ENDING_DECIDERS,
  },
  // Tail wiring: the handoff acknowledgement (client token path OR the staff
  // stand-in) closes the design-only ending. Issue family — owner/admin only.
  recipientAcknowledges: {
    from: 'design_only_handoff',
    to: 'closed_design_only',
    guards: ['handoffAcknowledged'],
    sideEffect: null,
    capability: 'engagements_issue',
  },
  chooseExecution: {
    from: 'execution_decision',
    to: 'execution',
    guards: ['balanceCleared'],
    sideEffect: null,
    capability: 'engagements_design',
    decidedBy: ENDING_DECIDERS,
  },
  // Design first, one link (owner ruling, Nov 2 2026): the client who took the
  // design only and later decides to build continues on the SAME row, so the same
  // link. The one edge that leaves a terminal state; the studio decides, as with
  // the endings, and the client's consent is signing the contract.
  continueToExecution: {
    from: 'closed_design_only',
    to: 'execution',
    guards: ['balanceCleared'],
    sideEffect: null,
    capability: 'engagements_design',
    decidedBy: ENDING_DECIDERS,
  },
} satisfies Record<string, TransitionDef>;
