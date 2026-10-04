// The orchestrator's ordering promise, with the database and Chromium mocked:
// a refused caller costs nothing, a failed render writes nothing, and the commit
// receives the number and year the PDF printed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import type { SendSnapshot } from '../snapshot';

vi.mock('server-only', () => ({}));

const { loadSendSnapshot, renderAndStoreClientBoqPdf, commitProposalBoqCore } = vi.hoisted(
  () => ({
    loadSendSnapshot: vi.fn(),
    renderAndStoreClientBoqPdf: vi.fn(),
    commitProposalBoqCore: vi.fn(),
  }),
);

vi.mock('../snapshot', () => ({ loadSendSnapshot }));
vi.mock('@/lib/boqs/issue', () => ({ renderAndStoreClientBoqPdf }));
vi.mock('./commit', () => ({ commitProposalBoqCore }));

const { sendProposalAsBoqCore } = await import('./send');
const { RendererBusyError } = await import('@/lib/pdf/renderer-busy');

const ctx = (role: OrgContext['role']) =>
  ({ orgId: 'org-1', userId: 'user-1', userEmail: 'a@b.c', role }) as OrgContext;

const snapshot: SendSnapshot = {
  proposal: {
    id: 'p1',
    revision: '1789000000000000',
    titleAr: null,
    titleEn: 'Bill of Quantities',
    notesAr: null,
    notesEn: null,
    discountPct: '0',
    currency: 'EGP',
  },
  engagement: { id: 'e1', clientId: 'c1', projectId: 'pr1' },
  source: [
    {
      titleAr: null,
      titleEn: 'Ceilings',
      lines: [
        {
          costItemId: null,
          itemCode: '2.01',
          descriptionAr: null,
          descriptionEn: 'Gypsum ceiling',
          qty: '10',
          unit: 'sqm',
          unitCost: '60',
          unitPrice: '100',
          discountPct: '0',
        },
      ],
    },
  ],
  nextBoqNumber: 14,
  renderYear: 2026,
  names: { orgAr: null, orgEn: 'Studio', clientAr: null, clientEn: 'Acme', projectAr: null, projectEn: 'Villa' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendProposalAsBoqCore', () => {
  it('refuses a viewer before reading or rendering anything', async () => {
    const res = await sendProposalAsBoqCore(ctx('viewer'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(loadSendSnapshot).not.toHaveBeenCalled();
    expect(renderAndStoreClientBoqPdf).not.toHaveBeenCalled();
  });

  it('passes a snapshot refusal through, unrendered', async () => {
    loadSendSnapshot.mockResolvedValue('line_required');
    const res = await sendProposalAsBoqCore(ctx('owner'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: false, error: 'line_required' });
    expect(renderAndStoreClientBoqPdf).not.toHaveBeenCalled();
  });

  it('returns generic and never commits when the renderer throws', async () => {
    loadSendSnapshot.mockResolvedValue(snapshot);
    renderAndStoreClientBoqPdf.mockRejectedValue(new Error('503 at the renderer cap'));
    const res = await sendProposalAsBoqCore(ctx('owner'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: false, error: 'generic' });
    expect(commitProposalBoqCore).not.toHaveBeenCalled();
  });

  it('answers renderer_busy (retryable) and never commits when the renderer is at its cap', async () => {
    loadSendSnapshot.mockResolvedValue(snapshot);
    renderAndStoreClientBoqPdf.mockRejectedValue(new RendererBusyError());
    const res = await sendProposalAsBoqCore(ctx('owner'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: false, error: 'renderer_busy' });
    expect(commitProposalBoqCore).not.toHaveBeenCalled();
  });

  it('renders the client copy WITHOUT cost, then commits the same number and year', async () => {
    loadSendSnapshot.mockResolvedValue(snapshot);
    renderAndStoreClientBoqPdf.mockResolvedValue({ fileId: 'f1', label: 'BQ-2026-0014.pdf' });
    commitProposalBoqCore.mockResolvedValue({
      ok: true,
      data: { boqId: 'b1', documentNumber: 'BQ-2026-0014' },
    });

    const res = await sendProposalAsBoqCore(ctx('project_manager'), {
      proposalId: 'p1',
      locale: 'en',
    });

    expect(res).toEqual({ ok: true, data: { documentNumber: 'BQ-2026-0014' } });
    const rendered = renderAndStoreClientBoqPdf.mock.calls[0][1];
    expect(rendered.year).toBe(2026);
    expect(rendered.detail.number).toBe(14);
    expect(rendered.detail).not.toHaveProperty('totalCost');
    expect(rendered.detail.sections[0].lines[0]).not.toHaveProperty('unitCost');
    const committed = commitProposalBoqCore.mock.calls[0][1];
    expect(committed).toMatchObject({
      proposalId: 'p1',
      expectedRevision: '1789000000000000',
      expectedNumber: 14,
      expectedYear: 2026,
      file: { fileId: 'f1', label: 'BQ-2026-0014.pdf' },
    });
    // The server copy keeps the cost: the commit writes it even for a PM.
    expect(committed.mapped.sections[0].lines[0].unitCost).toBe('60');
  });

  it('answers a replayed revision with the BOQ already sent, rendering and committing nothing', async () => {
    loadSendSnapshot.mockResolvedValue({
      alreadySent: { boqId: 'b1', documentNumber: 'BQ-2026-0014' },
    });
    const res = await sendProposalAsBoqCore(ctx('owner'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: true, data: { documentNumber: 'BQ-2026-0014' } });
    expect(renderAndStoreClientBoqPdf).not.toHaveBeenCalled();
    expect(commitProposalBoqCore).not.toHaveBeenCalled();
  });

  it('passes a commit conflict through as its code', async () => {
    loadSendSnapshot.mockResolvedValue(snapshot);
    renderAndStoreClientBoqPdf.mockResolvedValue({ fileId: 'f1', label: 'x.pdf' });
    commitProposalBoqCore.mockResolvedValue({ ok: false, error: 'boq_send_conflict' });
    const res = await sendProposalAsBoqCore(ctx('owner'), { proposalId: 'p1', locale: 'en' });
    expect(res).toEqual({ ok: false, error: 'boq_send_conflict' });
  });
});
