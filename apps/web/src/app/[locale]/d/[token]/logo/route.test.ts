import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AC 45: the studio logo is the rendition's BYTES, streamed from here: never a
// redirect and never a storage URL. Every miss is the same empty, uncached 404.

vi.mock('server-only', () => ({}));
const logo = vi.hoisted(() => ({ getDeliveryLogoByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-logo', () => logo);
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);

const { GET } = await import('./route');

const OBJECT_KEY = 'org-1/organization/logo-1';
const RENDER_SIGNED = `https://storage.test/render/image/sign/metra-files/${OBJECT_KEY}?token=R`;
const fetchMock = vi.fn();

function get(token = 'tok') {
  const request = new NextRequest(`https://app.test/en/d/${token}/logo`);
  return GET(request, { params: Promise.resolve({ locale: 'en', token }) });
}

async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

beforeEach(() => {
  logo.getDeliveryLogoByToken.mockReset().mockResolvedValue({ bucket: 'metra-files', objectKey: OBJECT_KEY });
  storage.createSignedObjectUrl.mockReset().mockResolvedValue(RENDER_SIGNED);
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('the logo route', () => {
  it('streams the 160 px rendition bytes, private and uncached, with no URL in the answer', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 8, 9]);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 30, {
      transform: { width: 160, height: 160, resize: 'contain', quality: 80 },
    });
    expect(fetchMock).toHaveBeenCalledWith(RENDER_SIGNED, expect.objectContaining({ redirect: 'error' }));
  });

  it('no logo, a revoked or malformed link: the empty 404', async () => {
    logo.getDeliveryLogoByToken.mockResolvedValue(null);
    await expectNotFound(await get());
    await expectNotFound(await get('%20'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a rendition Storage refused, a non-image answer, or a throw: the same 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 400 }));
    await expectNotFound(await get());
    fetchMock.mockResolvedValueOnce(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
    await expectNotFound(await get());
    storage.createSignedObjectUrl.mockRejectedValueOnce(new Error('storage down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expectNotFound(await get());
  });
});
