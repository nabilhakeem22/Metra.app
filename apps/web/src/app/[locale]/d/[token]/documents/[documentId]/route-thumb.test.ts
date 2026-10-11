import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countingRateLimit, fakePortalRateLimitEnv } from '@/test/fake-rate-limit-env';
import { PORTAL_READ_CEILING } from '@/test/wrangler-rate-limits';

// Round C, AC 51 and 52: a gallery tile (?variant=thumb) is the 480 px
// rendition's BYTES, streamed from the app whether the client has paid or not,
// never a storage URL; anything that is not a previewable image is the
// indistinguishable "unavailable" redirect, with nothing signed. Round D (W4):
// past the per-link read brake, a 429 with nothing looked up.

vi.mock('server-only', () => ({}));
const documents = vi.hoisted(() => ({ getDeliveryDocumentByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-documents', () => documents);
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);
vi.mock('@/lib/storage/object-info', () => ({ storedObjectInfo: vi.fn() }));
// Off-platform (no limit) unless a test puts the route on Cloudflare.
const cf = vi.hoisted(() => ({ isCloudflareRuntime: vi.fn(), cfEnv: vi.fn() }));
vi.mock('@/lib/cf/context', () => cf);

const { GET } = await import('./route');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = 'org-1/engagement/file-9';
const PAID = { bucket: 'metra-files', objectKey: OBJECT_KEY, downloadName: 'drawing.pdf', access: 'download', media: 'pdf' };
const UNPAID = { ...PAID, downloadName: 'render.png', access: 'preview', media: 'image' };
const PAID_IMAGE = { ...PAID, downloadName: 'render.png', media: 'image' };
const fetchMock = vi.fn();

function get(query: string, token = 'tok') {
  const request = new NextRequest(`https://app.test/en/d/${token}/documents/${DOCUMENT_ID}${query}`);
  return GET(request, { params: Promise.resolve({ locale: 'en', token, documentId: DOCUMENT_ID }) });
}

function expectRefused(response: Response) {
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('location')).toBeNull();
}

function expectUnavailable(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('https://app.test/en/d/tok?document=unavailable');
}

beforeEach(() => {
  cf.isCloudflareRuntime.mockReset().mockReturnValue(false);
  cf.cfEnv.mockReset();
  documents.getDeliveryDocumentByToken.mockReset();
  storage.createSignedObjectUrl.mockReset().mockResolvedValue('https://storage.test/render/image/sign/x?token=R');
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gallery tiles (?variant=thumb, AC 51, 52): streamed bytes, paid or not', () => {
  it.each([
    ['unpaid', UNPAID],
    ['paid', PAID_IMAGE],
  ])('%s image: the 480 px tile itself, never a URL', async (_label, document) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(document);
    const response = await get('?variant=thumb');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, max-age=240');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(storage.createSignedObjectUrl).toHaveBeenCalledTimes(1);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 30, {
      transform: { width: 480, height: 480, resize: 'cover', quality: 60 },
    });
  });

  it.each([
    ['a PDF', PAID],
    ['an other file', { ...PAID, downloadName: 'drawing.dwg', media: 'other' }],
    ['a withheld image', { ...PAID_IMAGE, access: 'withheld' }],
  ])('%s: unavailable, nothing signed', async (_label, document) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(document);
    expectUnavailable(await get('?variant=thumb'));
    expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
  });
});

describe('the per-link read brake (W4)', () => {
  it('on Cloudflare, the tile past the read ceiling for one link is a 429, nothing looked up; another link is served', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cf.isCloudflareRuntime.mockReturnValue(true);
    cf.cfEnv.mockReturnValue(fakePortalRateLimitEnv());
    documents.getDeliveryDocumentByToken.mockResolvedValue(UNPAID);
    fetchMock.mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }));
    for (let index = 0; index < PORTAL_READ_CEILING; index += 1) {
      expect((await get('?variant=thumb', 'loop-token')).status).toBe(200);
    }
    documents.getDeliveryDocumentByToken.mockClear();
    expectRefused(await get('?variant=thumb', 'loop-token'));
    expect(documents.getDeliveryDocumentByToken).not.toHaveBeenCalled();
    expect((await get('?variant=thumb', 'another-token')).status).toBe(200);
  });

  it('a refusing limiter refuses a download the same way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cf.isCloudflareRuntime.mockReturnValue(true);
    cf.cfEnv.mockReturnValue({ PORTAL_READ_RATE_LIMITER: countingRateLimit(0) });
    expectRefused(await get(''));
    expect(documents.getDeliveryDocumentByToken).not.toHaveBeenCalled();
  });

  it('F2: a Worker without its read binding answers the unavailable 303, logs the binding, looks nothing up', async () => {
    cf.isCloudflareRuntime.mockReturnValue(true);
    cf.cfEnv.mockReturnValue({});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expectUnavailable(await get('?variant=thumb'));
    expectUnavailable(await get(''));
    expect(documents.getDeliveryDocumentByToken).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][1]).toMatchObject({ binding: 'PORTAL_READ_RATE_LIMITER' });
  });
});
