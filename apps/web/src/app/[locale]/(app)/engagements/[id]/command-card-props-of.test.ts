import { describe, expect, it, vi } from 'vitest';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import type { EntryPhase } from '@/lib/flow/types';
import { commandCardPropsOf } from './command-card-props-of';
import type { EngagementDetailProps } from './engagement-detail-props';

// The cockpit at `execution` folds the finished design into one summary line,
// counted from what the page loaded. A LIGHT delivery (entry_phase
// 'execution', the client page of an execution contract) had no design, so it
// has no line to fold it into (H4 follow-up F2).

const EXECUTION_VIEW = { stage: 'in_progress' } as unknown as ExecutionCardView;

function detailAt(entryPhase: EntryPhase): EngagementDetailProps {
  return {
    header: {
      id: 'e-1',
      projectId: 'p-1',
      state: 'execution',
      entryPhase,
      revisionCount: 0,
      freeRevisionN: 2,
      designRevisionCount: 0,
      freeDesignRevisionN: 1,
      offPlan: false,
      rendersReadyAt: null,
      createdAt: '2026-10-01T09:00:00.000Z',
    },
    feeSchedule: { designFee: '1000.0000', milestones: [{ kind: 'deposit', basis: 'amount', value: '1000.0000' }] },
    payments: [],
    artifacts: [],
    transitions: [],
    nextActions: [],
    gatePreview: { clientDecision: null, primaryTrigger: null },
    capabilities: { recordPayment: true, setRom: true },
    paymentClaims: [],
    awaitingReplyCount: 0,
    clientExpected: null,
    execution: EXECUTION_VIEW,
  } as unknown as EngagementDetailProps;
}

const ACTION = { pending: false, runAction: vi.fn(), actionError: null };

describe('commandCardPropsOf at execution', () => {
  it('counts the design summary for a delivery that began with a design', () => {
    expect(commandCardPropsOf(detailAt('design'), ACTION, vi.fn()).execution).toEqual({
      view: EXECUTION_VIEW,
      designSummary: { openInstalments: 1, pendingClaims: 0, awaitingReply: 0 },
    });
  });

  it('has no design summary for a light delivery', () => {
    expect(commandCardPropsOf(detailAt('execution'), ACTION, vi.fn()).execution).toEqual({ view: EXECUTION_VIEW, designSummary: null });
  });
});
