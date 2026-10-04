// AC22: the builder preview of a BOQ working copy is the BOQ preview, not a
// quotation, and the internal (costed) variant is refused to a margin-blind
// caller before anything is loaded.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';

vi.mock('server-only', () => ({}));
const org = vi.hoisted(() => ({ row: { nameAr: null, nameEn: 'Studio', hide: false, defaultLocale: 'en' } }));
vi.mock('@/lib/db/context', () => ({ withOrgContext: async () => [org.row] }));
const reads = vi.hoisted(() => ({ getProposalForPdf: vi.fn() }));
vi.mock('@/lib/proposals/queries', () => reads);
const boqPreview = vi.hoisted(() => ({ renderBoqProposalPreviewHtml: vi.fn() }));
vi.mock('@/lib/boq-proposals/preview', () => boqPreview);
const template = vi.hoisted(() => ({ buildProposalHtml: vi.fn() }));
vi.mock('@/lib/pdf/proposal-template', () => template);

const { renderProposalPreviewHtml } = await import('./preview-html');

const ctx = (role: OrgContext['role']) =>
  ({ orgId: 'o1', userId: 'u1', userEmail: 'a@b.c', role }) as OrgContext;

beforeEach(() => {
  vi.clearAllMocks();
  org.row = { nameAr: null, nameEn: 'Studio', hide: false, defaultLocale: 'en' };
  boqPreview.renderBoqProposalPreviewHtml.mockResolvedValue({ ok: true, html: '<boq/>' });
  template.buildProposalHtml.mockResolvedValue('<quote/>');
});

describe('renderProposalPreviewHtml (AC22)', () => {
  it('dispatches a BOQ working copy to the BOQ preview, never the quotation template', async () => {
    reads.getProposalForPdf.mockResolvedValue({ id: 'p1', kind: 'boq' });
    const res = await renderProposalPreviewHtml(ctx('owner'), 'p1', 'client');
    expect(res).toEqual({ ok: true, html: '<boq/>' });
    expect(boqPreview.renderBoqProposalPreviewHtml).toHaveBeenCalledWith(ctx('owner'), {
      proposalId: 'p1',
      variant: 'client',
      locale: 'en',
      orgName: 'Studio',
    });
    expect(template.buildProposalHtml).not.toHaveBeenCalled();
  });

  it('refuses the internal variant to a margin-blind PM before loading anything', async () => {
    org.row = { ...org.row, hide: true };
    const res = await renderProposalPreviewHtml(ctx('project_manager'), 'p1', 'internal');
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(reads.getProposalForPdf).not.toHaveBeenCalled();
    expect(boqPreview.renderBoqProposalPreviewHtml).not.toHaveBeenCalled();
  });

  it('still previews a quote with the quotation template', async () => {
    reads.getProposalForPdf.mockResolvedValue({ id: 'p1', kind: 'quote' });
    const res = await renderProposalPreviewHtml(ctx('owner'), 'p1', 'client');
    expect(res).toEqual({ ok: true, html: '<quote/>' });
    expect(boqPreview.renderBoqProposalPreviewHtml).not.toHaveBeenCalled();
  });
});
