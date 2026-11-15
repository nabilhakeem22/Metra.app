// WHICH error a bad input throws first. The props are derived in the order the
// card lists them: the header's own fields, then the review-round start (10th),
// then the execution cockpit (30th). An input that is bad in two places must
// fail on the earlier one, so a derivation moved ahead of its prop is seen.
// Written against the function as it stood before its two derivations were
// named; green on that code and on the split.
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { commandCardPropsOf } from './command-card-props-of';
import type { EngagementDetailProps } from './engagement-detail-props';

const ACTION = { pending: false, runAction: vi.fn(), actionError: null };

function detailWith(
  header: Record<string, unknown> | undefined,
  feeSchedule: Record<string, unknown>,
): EngagementDetailProps {
  return {
    header,
    feeSchedule,
    payments: [],
    artifacts: [],
    transitions: [],
    nextActions: [],
    gatePreview: { clientDecision: null, primaryTrigger: null },
    capabilities: { recordPayment: true, setRom: true },
    paymentClaims: [],
    awaitingReplyCount: 0,
    clientExpected: null,
    execution: { stage: 'in_progress' } as unknown as ExecutionCardView,
  } as unknown as EngagementDetailProps;
}

const HEADER = {
  id: 'e-1',
  projectId: 'p-1',
  state: 'execution',
  entryPhase: 'design',
  revisionCount: 0,
  freeRevisionN: 2,
  designRevisionCount: 0,
  freeDesignRevisionN: 1,
  offPlan: false,
  rendersReadyAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
};

function thrownBy(detail: EngagementDetailProps): unknown {
  try {
    commandCardPropsOf(detail, ACTION, vi.fn());
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('commandCardPropsOf, which bad part fails first', () => {
  it('D-T8: with no header, fails on the first header field the card lists (its id)', () => {
    const thrown = thrownBy(detailWith(undefined, { designFee: '1000.0000', milestones: [] }));
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toMatch(/reading 'id'/);
  });

  it('D-T9: an invalid creation date fails before a fee schedule the design summary cannot read', () => {
    const thrown = thrownBy(
      detailWith({ ...HEADER, createdAt: 'not a date' }, { designFee: null, milestones: null }),
    );
    expect(thrown).toBeInstanceOf(RangeError);
  });

  it('D-T9: the same fee schedule alone fails in the design summary', () => {
    const thrown = thrownBy(detailWith(HEADER, { designFee: null, milestones: null }));
    expect(thrown).toBeInstanceOf(TypeError);
  });
});
