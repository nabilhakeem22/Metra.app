import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

// AC21 and the fix round: the tab's extra reads sit only on the branch where a Create
// or a New version button can show. A builder's version facts stand in for the
// contract lookup; the gate is read only with no live contract.

const reads = vi.hoisted(() => ({
  document: vi.fn(),
  contractId: vi.fn(),
  gate: vi.fn(),
  readiness: vi.fn(),
  liveContract: vi.fn(),
  openedContexts: 0,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/boqs/queries', () => ({ getBoqTabDocument: reads.document }));
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
const manager = { ...owner, role: 'project_manager' } as OrgContext;
const viewer = { ...owner, role: 'viewer' } as OrgContext;
const engineer = { ...owner, role: 'site_engineer' } as OrgContext;
const issued = { id: 'b', status: 'issued', clientId: 'c', engagementId: 'd1' };
const HOME = { kind: 'home', delivery: { id: 'd1', number: 1, createdAt: '2026-06-01', state: 'execution', entryPhase: 'design' } };
const version = (contractId: string | null, contractIsLive: boolean) => ({ contractId, contractIsLive, draftId: null });

function document(boq: unknown, issuedVersion: unknown = null): void {
  reads.document.mockResolvedValue({ boq, issuedVersion });
}

beforeEach(() => {
  vi.clearAllMocks();
  reads.openedContexts = 0;
  reads.gate.mockResolvedValue(HOME);
  reads.contractId.mockResolvedValue(null);
  reads.readiness.mockResolvedValue({ hasDelivery: true, clientCanOpen: true });
  reads.liveContract.mockResolvedValue(false);
});

describe('the reads of an issued BOQ', () => {
  it('a builder, no contract: the gate once, for that pair, and no contract lookup', async () => {
    document(issued, version(null, false));
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.gate).toHaveBeenCalledTimes(1);
    expect(reads.gate).toHaveBeenCalledWith({}, { projectId: 'p', clientId: 'c' });
    expect(reads.contractId).not.toHaveBeenCalled();
    expect(reads.openedContexts).toBe(1);
    expect(tab.execution).toEqual({ contractId: null, canGenerate: true, refusal: null, canStartVersion: true });
  });

  it('a builder, a live contract: no gate, no lookup, nothing more than before', async () => {
    document(issued, version('contract-1', true));
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.gate).not.toHaveBeenCalled();
    expect(reads.contractId).not.toHaveBeenCalled();
    expect(reads.openedContexts).toBe(0);
    expect(tab.execution).toEqual({ contractId: 'contract-1', canGenerate: true, refusal: null, canStartVersion: false });
  });

  it('a builder, a terminated contract: the gate, Open contract and New version', async () => {
    document(issued, version('contract-1', false));
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.gate).toHaveBeenCalledTimes(1);
    expect(tab.execution).toEqual({ contractId: 'contract-1', canGenerate: true, refusal: null, canStartVersion: true });
  });

  it('a project manager has no contract to open, and may start a version', async () => {
    document(issued, version('contract-1', false));
    const tab = await loadBoqTab(manager, 'p');
    expect(tab.execution).toEqual({ contractId: null, canGenerate: false, refusal: null, canStartVersion: true });
  });

  it('a reader of contracts who does not build: the lookup as before, no gate', async () => {
    document(issued);
    reads.contractId.mockResolvedValue('contract-1');
    const tab = await loadBoqTab(viewer, 'p');
    expect(reads.document).toHaveBeenCalledWith(viewer, 'p', { showCost: expect.any(Boolean), canBuild: false });
    expect(reads.gate).not.toHaveBeenCalled();
    expect(tab.execution).toEqual({ contractId: 'contract-1', canGenerate: false, refusal: null, canStartVersion: false });
  });

  it('a reader of neither: no read at all', async () => {
    document(issued);
    const tab = await loadBoqTab(engineer, 'p');
    expect(reads.contractId).not.toHaveBeenCalled();
    expect(reads.gate).not.toHaveBeenCalled();
    expect(tab.execution.canStartVersion).toBe(false);
  });

  it('a draft, or no BOQ: no gate', async () => {
    document({ ...issued, status: 'draft' });
    await loadBoqTab(owner, 'p');
    document(null);
    await loadBoqTab(owner, 'p');
    expect(reads.gate).not.toHaveBeenCalled();
  });

  it('the refusal the gate gives replaces the Create, and New version waits for the home', async () => {
    document(issued, version(null, false));
    reads.gate.mockResolvedValue({ kind: 'design_open', delivery: { ...HOME.delivery, state: 'boq' } });
    const tab = await loadBoqTab(owner, 'p');
    expect(tab.execution.refusal).toEqual({ code: 'design_open', params: { delivery: 'DE-2026-0001', deliveryId: 'd1' } });
    expect(tab.execution.canStartVersion).toBe(false);
  });
});

describe('what Issue needs to know', () => {
  it('a draft with no delivery: Issue needs one, and the readiness read stays the one it was', async () => {
    document({ ...issued, status: 'draft', engagementId: null });
    reads.readiness.mockResolvedValue({ hasDelivery: false, clientCanOpen: false });
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.readiness).toHaveBeenCalledTimes(1);
    expect(tab.issueNeedsDelivery).toBe(true);
    expect(tab.clientCanOpenOnIssue).toBe(false);
  });

  it('an issued BOQ asks nothing about Issue', async () => {
    document(issued, version(null, false));
    const tab = await loadBoqTab(owner, 'p');
    expect(reads.readiness).not.toHaveBeenCalled();
    expect(tab.issueNeedsDelivery).toBe(false);
  });
});
