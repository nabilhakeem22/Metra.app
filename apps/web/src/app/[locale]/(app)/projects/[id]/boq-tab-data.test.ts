import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

// AC21: the design-first gate costs the BOQ tab one read, and only on an issued
// BOQ with no contract that a Create button would be offered on.

const reads = vi.hoisted(() => ({
  boq: vi.fn(),
  contractId: vi.fn(),
  gate: vi.fn(),
  readiness: vi.fn(),
  liveContract: vi.fn(),
  openedContexts: 0,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/boqs/queries', () => ({ getProjectBoq: reads.boq }));
vi.mock('@/lib/contracts/queries', () => ({ getContractIdForBoq: reads.contractId }));
vi.mock('@/lib/boqs/issue', () => ({ getBoqIssueReadiness: reads.readiness, projectHasLiveContractOnIssuedBoq: reads.liveContract }));
vi.mock('@/lib/engagements/pair-home', () => ({ readExecutionGate: reads.gate }));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: (_ctx: unknown, run: (tx: unknown) => unknown) => {
    reads.openedContexts += 1;
    return run({});
  },
}));

import { loadBoqTab } from './boq-tab-data';

const owner = { orgId: 'o', userId: 'u', role: 'owner' } as OrgContext;
const viewer = { ...owner, role: 'viewer' } as OrgContext;
const issued = { id: 'b', status: 'issued', clientId: 'c', engagementId: 'd1' };
const HOME = { kind: 'home', delivery: { id: 'd1', number: 1, createdAt: '2026-06-01', state: 'execution', entryPhase: 'design' } };

beforeEach(() => {
  vi.clearAllMocks();
  reads.openedContexts = 0;
  reads.gate.mockResolvedValue(HOME);
  reads.contractId.mockResolvedValue(null);
  reads.readiness.mockResolvedValue({ hasDelivery: true, clientCanOpen: true });
  reads.liveContract.mockResolvedValue(false);
});

describe('the gate read', () => {
  it('an issued BOQ with no contract: one read, for that pair', async () => {
    reads.boq.mockResolvedValue(issued);
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.gate).toHaveBeenCalledTimes(1);
    expect(reads.gate).toHaveBeenCalledWith({}, { projectId: 'p', clientId: 'c' });
    expect(reads.openedContexts).toBe(1);
    expect(tab.execution).toEqual({ contractId: null, canGenerate: true, refusal: null });
  });

  it('an issued BOQ with a contract: none', async () => {
    reads.boq.mockResolvedValue(issued);
    reads.contractId.mockResolvedValue('contract-1');
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.gate).not.toHaveBeenCalled();
    expect(tab.execution).toEqual({ contractId: 'contract-1', canGenerate: true, refusal: null });
  });

  it('a role that may not generate: none, and no refusal to read', async () => {
    reads.boq.mockResolvedValue(issued);
    const tab = await loadBoqTab(viewer, 'p');
    expect(reads.gate).not.toHaveBeenCalled();
    expect(tab.execution.refusal).toBeNull();
  });

  it('a draft, or no BOQ: none', async () => {
    reads.boq.mockResolvedValue({ ...issued, status: 'draft' });
    await loadBoqTab(owner, 'p');
    reads.boq.mockResolvedValue(null);
    await loadBoqTab(owner, 'p');
    expect(reads.gate).not.toHaveBeenCalled();
  });

  it('the refusal the gate gives replaces the Create', async () => {
    reads.boq.mockResolvedValue(issued);
    reads.gate.mockResolvedValue({ kind: 'design_open', delivery: { ...HOME.delivery, state: 'boq' } });
    const tab = await loadBoqTab(owner, 'p');
    expect(tab.execution.refusal).toEqual({ code: 'design_open', params: { delivery: 'DE-2026-0001', deliveryId: 'd1' } });
  });
});

describe('what Issue needs to know', () => {
  it('a draft with no delivery: Issue needs one, and the readiness read stays the one it was', async () => {
    reads.boq.mockResolvedValue({ ...issued, status: 'draft', engagementId: null });
    reads.readiness.mockResolvedValue({ hasDelivery: false, clientCanOpen: false });
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.readiness).toHaveBeenCalledTimes(1);
    expect(tab.issueNeedsDelivery).toBe(true);
    expect(tab.clientCanOpenOnIssue).toBe(false);
  });

  it('an issued BOQ asks nothing about Issue', async () => {
    reads.boq.mockResolvedValue(issued);
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.readiness).not.toHaveBeenCalled();
    expect(tab.issueNeedsDelivery).toBe(false);
  });
});
