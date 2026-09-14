import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const session = vi.fn();
const org = vi.fn();
const render = vi.fn();
const orgRow = vi.fn();

vi.mock('@/lib/auth/session', () => ({ getSessionUser: () => session() }));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: () => org() }));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async () => orgRow(),
}));
vi.mock('@/lib/pdf/render', async () => {
  const actual = await vi.importActual<typeof import('./render')>('./render');
  return { ...actual, renderPdf: (html: string) => render(html) };
});

const { RendererBusyError } = await import('./render');
const { servePdfDocument } = await import('./route-handler');

interface StubDetail {
  lines: number;
}

function spec(overrides: Partial<Parameters<typeof servePdfDocument<StubDetail>>[2]> = {}) {
  return {
    capability: 'proposals_build' as const,
    logLabel: 'Stub',
    maxLines: 10,
    load: vi.fn(async () => ({ lines: 1 }) as StubDetail),
    lineCount: (detail: StubDetail) => detail.lines,
    buildHtml: vi.fn(async () => '<html></html>'),
    fileName: () => 'stub.pdf',
    ...overrides,
  };
}

const request = (url = 'https://app.metra.test/api/pdf/x/1') => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ id: 'u1' });
  org.mockResolvedValue({ orgId: 'o1', userId: 'u1', role: 'owner' });
  orgRow.mockResolvedValue([
    { nameAr: 'ميترا', nameEn: 'Metra', defaultLocale: 'en', hideMarginFromPm: false },
  ]);
  render.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('servePdfDocument — the order the three routes must follow', () => {
  it('401s with no session, and never touches the document', async () => {
    session.mockResolvedValue(null);
    const stub = spec();
    const res = await servePdfDocument(request(), '1', stub);
    expect(res.status).toBe(401);
    expect(stub.load).not.toHaveBeenCalled();
  });

  it('403s a role without the read capability', async () => {
    // accountant has no read on boq_build at all (viewer does, so it would pass).
    org.mockResolvedValue({ orgId: 'o1', userId: 'u1', role: 'accountant' });
    const stub = spec({ capability: 'boq_build' });
    const res = await servePdfDocument(request(), '1', stub);
    expect(res.status).toBe(403);
    expect(stub.load).not.toHaveBeenCalled();
  });

  it('403s the internal copy for a margin-blind role BEFORE loading it', async () => {
    // The gate has to precede the load, because the load is what fetches cost.
    org.mockResolvedValue({ orgId: 'o1', userId: 'u1', role: 'project_manager' });
    orgRow.mockResolvedValue([
      { nameAr: null, nameEn: 'Metra', defaultLocale: 'en', hideMarginFromPm: true },
    ]);
    const stub = spec();
    const res = await servePdfDocument(
      request('https://app.metra.test/api/pdf/x/1?variant=internal'),
      '1',
      stub,
    );
    expect(res.status).toBe(403);
    expect(stub.load).not.toHaveBeenCalled();
  });

  it('404s a document that does not resolve', async () => {
    const stub = spec({ load: vi.fn(async () => null) });
    expect((await servePdfDocument(request(), '1', stub)).status).toBe(404);
  });

  it('413s a document past the line cap WITHOUT asking the renderer', async () => {
    const stub = spec({ load: vi.fn(async () => ({ lines: 11 })) });
    const res = await servePdfDocument(request(), '1', stub);
    expect(res.status).toBe(413);
    expect(render).not.toHaveBeenCalled();
    expect(stub.buildHtml).not.toHaveBeenCalled();
  });

  it('200s with the pdf headers, including no-store', async () => {
    const res = await servePdfDocument(request(), '1', spec());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="stub.pdf"');
    // The internal copy carries margin; no-store is on EVERY response so the
    // rule cannot depend on which variant a future reader thinks they are in.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('503s with retry-after when the renderer is busy, not 500', async () => {
    render.mockRejectedValue(new RendererBusyError());
    const res = await servePdfDocument(request(), '1', spec());
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
  });

  it('500s any other render failure', async () => {
    render.mockRejectedValue(new Error('chromium died'));
    expect((await servePdfDocument(request(), '1', spec())).status).toBe(500);
  });
});

describe('servePdfDocument — the variant', () => {
  it('defaults to the client copy and loads it WITHOUT cost', async () => {
    const stub = spec();
    await servePdfDocument(request('https://app.metra.test/api/pdf/x/1?variant=bogus'), '1', stub);
    expect(stub.load).toHaveBeenCalledWith(expect.anything(), '1', false);
  });

  it('loads cost only for ?variant=internal', async () => {
    const stub = spec();
    await servePdfDocument(
      request('https://app.metra.test/api/pdf/x/1?variant=internal'),
      '1',
      stub,
    );
    expect(stub.load).toHaveBeenCalledWith(expect.anything(), '1', true);
  });
});

describe('servePdfDocument — the org lookup', () => {
  it('falls back to a margin-HIDING default when the row is missing', async () => {
    // Losing branding is survivable; defaulting the other way would leak cost.
    orgRow.mockResolvedValue([]);
    org.mockResolvedValue({ orgId: 'o1', userId: 'u1', role: 'project_manager' });
    const res = await servePdfDocument(
      request('https://app.metra.test/api/pdf/x/1?variant=internal'),
      '1',
      spec(),
    );
    expect(res.status).toBe(403);
  });

  it('hands the template the org and its locale', async () => {
    const stub = spec();
    await servePdfDocument(request(), '1', stub);
    expect(stub.buildHtml).toHaveBeenCalledWith(
      { lines: 1 },
      {
        locale: 'en',
        variant: 'client',
        org: { nameAr: 'ميترا', nameEn: 'Metra', defaultLocale: 'en', hideMarginFromPm: false },
      },
    );
  });
});
