// AC22: a BOQ-kind proposal never renders as a quotation. The real
// servePdfDocument runs; auth, the database and Chromium are replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => false,
  cfEnv: () => {
    throw new Error('getCloudflareContext() called off-platform');
  },
}));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/auth/require-org', () => ({
  requireOrg: async () => ({ orgId: 'o1', userId: 'u1', userEmail: 'a@b.c', role: 'owner' }),
}));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async () => [
    { nameAr: null, nameEn: 'Studio', defaultLocale: 'en', hideMarginFromPm: false },
  ],
}));
const reads = vi.hoisted(() => ({ getProposalForPdf: vi.fn() }));
vi.mock('@/lib/proposals/queries', () => reads);
const render = vi.hoisted(() => ({ renderPdf: vi.fn() }));
vi.mock('@/lib/pdf/render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/render')>()),
  renderPdf: render.renderPdf,
}));
const template = vi.hoisted(() => ({ buildProposalHtml: vi.fn() }));
vi.mock('@/lib/pdf/proposal-template', () => template);

const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  render.renderPdf.mockResolvedValue(new Uint8Array([1]));
  template.buildProposalHtml.mockResolvedValue('<html></html>');
});

const get = () =>
  GET(new Request('https://app.metra.test/api/pdf/proposals/p1'), {
    params: Promise.resolve({ id: 'p1' }),
  });

describe('GET /api/pdf/proposals/[id] (AC22)', () => {
  it('404s a BOQ-kind proposal and never builds or renders a quotation', async () => {
    reads.getProposalForPdf.mockResolvedValue({ id: 'p1', kind: 'boq', number: 3, sections: [] });
    const res = await get();
    expect(res.status).toBe(404);
    expect(template.buildProposalHtml).not.toHaveBeenCalled();
    expect(render.renderPdf).not.toHaveBeenCalled();
  });

  it('still renders a quote', async () => {
    reads.getProposalForPdf.mockResolvedValue({ id: 'p1', kind: 'quote', number: 3, sections: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(template.buildProposalHtml).toHaveBeenCalled();
  });
});
