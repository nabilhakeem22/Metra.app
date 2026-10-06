import type { DesignEngagement, EngagementMilestone } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { evaluateGatePreview } from './gate-preview-evaluate';
import type { GuardFacts } from './guards';
import type { DesignState } from './states';

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const EPOCH = new Date('2026-01-01T00:00:00Z');

function engagement(state: DesignState, designFee: string | null): DesignEngagement {
  return {
    id: ENGAGEMENT_ID,
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    number: 1,
    titleAr: 'تشطيب',
    titleEn: 'Fit-out',
    clientId: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    state,
    designFee,
    offPlan: false,
    asBuiltDue: false,
    freeRevisionN: 3,
    revisionCount: 0,
    freeDesignRevisionN: 3,
    designRevisionCount: 0,
    romLow: null,
    romHigh: null,
    romIssuedAt: null,
    conceptLockedAt: null,
    renderManifestHash: null,
    rendersReadyAt: null,
    tokenHash: null,
    shareExpiresAt: null,
  };
}

function balanceMilestone(): EngagementMilestone {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    orgId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    engagementId: ENGAGEMENT_ID,
    kind: 'balance',
    basis: 'percent',
    value: '20.0000',
    sortOrder: 3,
  };
}

function facts(state: DesignState, milestones: EngagementMilestone[]): GuardFacts {
  return {
    engagement: engagement(state, '10000.0000'),
    milestones,
    payments: [],
    artifacts: [],
    changeOrders: [],
    events: [],
  };
}

describe('evaluateGatePreview', () => {
  it('offers the endings, not a forward trigger, at execution_decision', () => {
    const preview = evaluateGatePreview(facts('execution_decision', []));
    expect(preview.primaryTrigger).toBeNull();
    expect(preview.endingChoices).toEqual(['chooseDesignOnly', 'chooseExecution']);
    expect(preview.items.map((item) => item.guard)).toEqual(['balanceCleared']);
    expect(preview.allClear).toBe(true);
  });

  it('carries the balance shortfall on the endings checklist while it is unpaid', () => {
    const preview = evaluateGatePreview(facts('execution_decision', [balanceMilestone()]));
    expect(preview.allClear).toBe(false);
    expect(preview.items[0]).toMatchObject({ guard: 'balanceCleared', ok: false, amountDue: '2000.0000' });
  });

  it('resolves the forward trigger elsewhere, with no endings', () => {
    const preview = evaluateGatePreview(facts('boq', []));
    expect(preview.primaryTrigger).toBe('finalizeBOQ');
    expect(preview.endingChoices).toEqual([]);
  });

  it('is empty and all-clear at a terminal state', () => {
    expect(evaluateGatePreview(facts('execution', []))).toEqual({
      primaryTrigger: null,
      endingChoices: [],
      items: [],
      allClear: true,
    });
  });
});
