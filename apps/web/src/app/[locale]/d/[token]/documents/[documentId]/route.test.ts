import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MAX_EDGE, PREVIEW_QUALITY } from '@/lib/engagements/document-access';

// The client document route. PAID (`download`): a 300 s signed redirect, saved as
// an attachment unless a safe file asks to open. UNPAID (`preview`): the
// downscaled bytes streamed from here, and never any URL that names the object.
// Anything else: the indistinguishable "unavailable" redirect.

vi.mock('server-only', () => ({}));
const documents = vi.hoisted(() => ({ getDeliveryDocumentByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-documents', () => documents);
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);
const info = vi.hoisted(() => ({ storedObjectInfo: vi.fn() }));
vi.mock('@/lib/storage/object-info', () => info);

const { GET } = await import('./route');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = 'org-1/engagement/file-9';
const SIGNED = `https://storage.test/object/sign/metra-files/${OBJECT_KEY}?token=T`;
const RENDER_SIGNED = `https://storage.test/render/image/sign/metra-files/${OBJECT_KEY}?token=R`;
const PAID = { bucket: 'metra-files', objectKey: OBJECT_KEY, downloadName: 'drawing.pdf', access: 'download' };
const UNPAID = { ...PAID, downloadName: 'render.png', access: 'preview' };
const PREVIEW_TRANSFORM = {
  transform: { width: PREVIEW_MAX_EDGE, height: PREVIEW_MAX_EDGE, resize: 'contain', quality: PREVIEW_QUALITY },
};
const fetchMock = vi.fn();

function get(query = '', documentId = DOCUMENT_ID, token = 'tok') {
  const request = new NextRequest(`https://app.test/en/d/${token}/documents/${documentId}${query}`);
  return GET(request, { params: Promise.resolve({ locale: 'en', token, documentId }) });
}

function expectUnavailable(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('https://app.test/en/d/tok?document=unavailable');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

beforeEach(() => {
  documents.getDeliveryDocumentByToken.mockReset().mockResolvedValue(PAID);
  storage.createSignedObjectUrl.mockReset().mockImplementation(
    async (_bucket: string, _key: string, _ttl: number, opts?: { transform?: unknown }) => (opts?.transform ? RENDER_SIGNED : SIGNED),
  );
  info.storedObjectInfo.mockReset().mockResolvedValue({ contentType: 'application/pdf', size: 1000 });
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('paid: a signed redirect', () => {
  it('no variant: saved as an attachment with the client-facing name, 300 s', async () => {
    const response = await get();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(SIGNED);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 300, { download: 'drawing.pdf' });
  });

  it('?variant=view of a PDF stored as a PDF opens in the browser (no download name)', async () => {
    expect((await get('?variant=view')).status).toBe(302);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 300, undefined);
  });

  it.each([
    ['a PDF stored as SVG', 'drawing.pdf', 'image/svg+xml'],
    ['a PDF stored as HTML', 'drawing.pdf', 'text/html'],
    ['a PNG stored as XHTML', 'render.png', 'application/xhtml+xml'],
    ['a DWG', 'drawing.dwg', 'application/acad'],
    ['an unknown stored type', 'drawing.pdf', null],
  ])('?variant=view of %s falls back to the attachment', async (_label, downloadName, contentType) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue({ ...PAID, downloadName });
    info.storedObjectInfo.mockResolvedValue(contentType ? { contentType, size: 10 } : null);
    expect((await get('?variant=view')).status).toBe(302);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 300, { download: downloadName });
  });
});

describe('unpaid (preview): bytes, never a storage URL', () => {
  it.each(['', '?variant=view'])('streams the downscaled image itself (%s)', async (query) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(UNPAID);
    const response = await get(query);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    // Signed only with the transform, fetched on the server, and the URL stays there.
    expect(storage.createSignedObjectUrl).toHaveBeenCalledTimes(1);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 30, PREVIEW_TRANSFORM);
    expect(fetchMock).toHaveBeenCalledWith(RENDER_SIGNED, expect.objectContaining({ redirect: 'error' }));
    const visible = JSON.stringify([...response.headers.entries()]);
    expect(visible).not.toContain(OBJECT_KEY);
    expect(visible).not.toContain('storage.test');
  });

  it.each([
    ['Storage could not transform it (a PDF comes back whole)', new Response('pdf', { headers: { 'content-type': 'application/pdf' } })],
    ['Storage refused', new Response('no', { status: 400 })],
    ['it declares more than the ceiling', new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) } })],
  ])('when %s: unavailable, and still no URL', async (_label, upstream) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(UNPAID);
    fetchMock.mockResolvedValue(upstream);
    expectUnavailable(await get('?variant=view'));
  });
});

describe('refusals', () => {
  it.each(['?variant=other', '?variant=thumb', '?variant=', '?variant=VIEW'])('%s: unavailable, before any read', async (query) => {
    expectUnavailable(await get(query));
    expect(documents.getDeliveryDocumentByToken).not.toHaveBeenCalled();
  });

  it('a withheld document is refused the same way, whichever variant', async () => {
    documents.getDeliveryDocumentByToken.mockResolvedValue({ ...PAID, access: 'withheld' });
    expectUnavailable(await get('?variant=view'));
    expectUnavailable(await get());
    expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('a malformed id, an unknown document or a storage failure: the same redirect', async () => {
    expectUnavailable(await get('?variant=view', 'not-a-uuid'));
    documents.getDeliveryDocumentByToken.mockResolvedValue(null);
    expectUnavailable(await get('?variant=view'));
    documents.getDeliveryDocumentByToken.mockResolvedValue(PAID);
    storage.createSignedObjectUrl.mockRejectedValue(new Error('storage down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expectUnavailable(await get());
    expect(logged).toHaveBeenCalledWith('delivery document download failed');
    logged.mockRestore();
  });

  it('F13: an already-encoded token is not encoded twice in the redirect', async () => {
    const response = await get('?variant=bad', DOCUMENT_ID, 'dead%20beef');
    expect(response.headers.get('location')).toBe('https://app.test/en/d/dead%20beef?document=unavailable');
  });
});
