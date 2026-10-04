// F5: the BOQ PDF is named by the BOQ's identity, BQ-YYYY-NNNN, as the issued
// client copy is. The real servePdfDocument runs; auth, the database and
// Chromium are replaced.
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
    {
      boqId: 'b1',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      clientAr: null,
      clientEn: 'Acme',
      projectAr: null,
      projectEn: 'Villa',
      orgAr: null,
      orgEn: 'Studio',
      defaultLocale: 'en',
      hideMarginFromPm: false,
    },
  ],
}));
vi.mock('@/lib/boqs/core', () => ({ MAX_BOQ_LINES: 2000 }));
const reads = vi.hoisted(() => ({ getBoqDetail: vi.fn() }));
vi.mock('@/lib/boqs/queries', () => reads);
vi.mock('@/lib/pdf/render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/render')>()),
  renderPdf: async () => new Uint8Array([1]),
}));

const { GET } = await import('./route');

const detail = {
  id: 'b1',
  number: 7,
  documentNumber: 'BQ-2026-0007',
  version: 1,
  title: 'BOQ',
  status: 'issued',
  source: 'built',
  currency: 'EGP',
  discountPct: '0',
  subtotal: '100.0000',
  discountAmount: '0.0000',
  total: '100.0000',
  lineCount: 0,
  sections: [],
  totalCost: '60.0000',
  totalMargin: '40.0000',
};

beforeEach(() => {
  reads.getBoqDetail.mockReset();
  reads.getBoqDetail.mockResolvedValue(detail);
});

async function download(query = '') {
  return GET(new Request(`https://app.metra.test/api/pdf/boq/b1${query}`), {
    params: Promise.resolve({ id: 'b1' }),
  });
}

describe('GET /api/pdf/boq/[id] file name (F5)', () => {
  it('names the internal copy BQ-YYYY-NNNN-internal.pdf', async () => {
    const res = await download('?variant=internal');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('filename="BQ-2026-0007-internal.pdf"');
  });

  it('names the client copy BQ-YYYY-NNNN.pdf', async () => {
    const res = await download();
    expect(res.headers.get('content-disposition')).toContain('filename="BQ-2026-0007.pdf"');
  });
});
