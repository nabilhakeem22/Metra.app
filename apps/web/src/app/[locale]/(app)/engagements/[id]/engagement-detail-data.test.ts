import { describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

vi.mock('server-only', () => ({}));

// THE COCKPIT'S READ COUNT. Every read the page makes is replaced by a spy, so
// what this pins is the one property a database cannot be asked about: how many
// round trips one render costs. The execution phase switch (client home H2)
// adds none: the flow facts the execution step card reads ride the execution
// facts read, which happens only at `execution`.
const reads = vi.hoisted(() => {
  const read = (value: unknown) => vi.fn(async () => value);
  return {
    getEngagementHeader: vi.fn(),
    getEngagementFeeSchedule: read({ designFee: null, milestones: [] }),
    getEngagementPayments: read([]),
    getEngagementArtifacts: read([]),
    getEngagementEvents: read([]),
    getEngagementChangeOrders: read([]),
    getEngagementTransitions: read([]),
    getEngagementClientActivity: read([]),
    getEngagementPaymentClaims: read([]),
    getDeliveryShareStatus: read({ shared: false, expiresAt: null }),
    getLastUsedFeeSchedule: read(null),
    getEngagementGatePreview: read({ items: [] }),
    countAwaitingReplyCore: read(0),
    loadBoqStep: read({}),
    getExecutionFacts: read({
      flow: { stage: { hasIssuedBoq: false, contract: null }, signingOpen: false, issuedChangeOrderCount: 0, expiredChangeOrderCount: 0, unclaimedDueRequestCount: 0 },
      boqId: null,
      contract: null,
      nextInstalment: null,
    }),
  };
});
vi.mock('@/lib/engagements/queries', () => ({
  getEngagementHeader: reads.getEngagementHeader,
  getEngagementFeeSchedule: reads.getEngagementFeeSchedule,
  getEngagementPayments: reads.getEngagementPayments,
  getEngagementArtifacts: reads.getEngagementArtifacts,
  getEngagementEvents: reads.getEngagementEvents,
  getEngagementChangeOrders: reads.getEngagementChangeOrders,
  getEngagementTransitions: reads.getEngagementTransitions,
  getEngagementClientActivity: reads.getEngagementClientActivity,
  getEngagementPaymentClaims: reads.getEngagementPaymentClaims,
  getDeliveryShareStatus: reads.getDeliveryShareStatus,
  getLastUsedFeeSchedule: reads.getLastUsedFeeSchedule,
}));
vi.mock('@/lib/engagements/gate-preview', () => ({ getEngagementGatePreview: reads.getEngagementGatePreview }));
vi.mock('@/lib/engagements/document-comments', () => ({ countAwaitingReplyCore: reads.countAwaitingReplyCore }));
vi.mock('./boq-step-data', () => ({ loadBoqStep: reads.loadBoqStep }));
vi.mock('@/lib/execution/queries/facts', () => ({ getExecutionFacts: reads.getExecutionFacts }));

const { loadEngagementDetail } = await import('./engagement-detail-data');

const CTX: OrgContext = { orgId: 'org-1', userId: 'user-1', role: 'owner' };

function totalReads(): number {
  return Object.values(reads).reduce((sum, spy) => sum + spy.mock.calls.length, 0);
}

async function loadAt(state: string) {
  for (const spy of Object.values(reads)) spy.mockClear();
  reads.getEngagementHeader.mockResolvedValue({ id: 'e-1', projectId: 'p-1', state });
  return loadEngagementDetail(CTX, 'e-1');
}

describe('loadEngagementDetail', () => {
  it('at execution: fourteen reads, the execution facts (with the flow facts) once', async () => {
    const data = await loadAt('execution');
    expect(data?.execution?.flow.signingOpen).toBe(false);
    expect(reads.getEngagementHeader).toHaveBeenCalledTimes(1);
    expect(reads.getExecutionFacts).toHaveBeenCalledTimes(1);
    expect(reads.getLastUsedFeeSchedule).not.toHaveBeenCalled();
    expect(totalReads()).toBe(14);
  });

  it('in the design phase: no execution read, so one fewer', async () => {
    const data = await loadAt('survey');
    expect(data?.execution).toBeNull();
    expect(reads.getExecutionFacts).not.toHaveBeenCalled();
    expect(totalReads()).toBe(13);
  });

  it('an engagement that does not resolve costs the header read alone', async () => {
    for (const spy of Object.values(reads)) spy.mockClear();
    reads.getEngagementHeader.mockResolvedValue(null);
    expect(await loadEngagementDetail(CTX, 'e-1')).toBeNull();
    expect(totalReads()).toBe(1);
  });
});
