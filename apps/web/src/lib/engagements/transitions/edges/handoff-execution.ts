// Design-Engagement Machine — the edges that LEAVE the handoff_execution phase
// (`execution_decision`, `design_only_handoff`; see phases.ts). A trigger is filed
// by the phase of its SOURCE state. These are the two endings and the
// acknowledgement that closes the design-only one. PURE, CLIENT-SAFE DATA.
import type { TransitionDef } from '../types';

export const HANDOFF_EXECUTION_EDGES = {
  // Tail wiring (owner-locked): the BALANCE gates BOTH execution-decision exits —
  // the final installment clears before either ending.
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
  },
} satisfies Record<string, TransitionDef>;
