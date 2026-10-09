import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('./signed-urls', () => storage);

const { fetchImageRendition, RENDITION_MAX_BYTES } = await import('./image-rendition');

const TRANSFORM = { width: 100, height: 100, resize: 'contain', quality: 60 } as const;
const fetchMock = vi.fn();

/** A body that streams `total` bytes in 1 MB chunks and declares no length. */
function streamOf(total: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) return controller.close();
      const size = Math.min(1024 * 1024, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

beforeEach(() => {
  storage.createSignedObjectUrl.mockReset().mockResolvedValue('https://storage.test/render/x');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchImageRendition', () => {
  it('signs for 30 s with the transform only, and streams an image', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(10), { headers: { 'content-type': 'image/webp; q=1' } }));
    const rendition = await fetchImageRendition('b', 'k', TRANSFORM);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('b', 'k', 30, { transform: TRANSFORM });
    expect(rendition?.contentType).toBe('image/webp');
    expect((await new Response(rendition!.body).arrayBuffer()).byteLength).toBe(10);
  });

  it('a body that runs past the ceiling without declaring it errors instead of streaming on', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(RENDITION_MAX_BYTES + 1), { headers: { 'content-type': 'image/jpeg' } }));
    const rendition = await fetchImageRendition('b', 'k', TRANSFORM);
    await expect(new Response(rendition!.body).arrayBuffer()).rejects.toThrow();
  });

  it.each(['image/svg+xml', 'text/html', 'application/pdf', ''])('refuses a %s answer', async (type) => {
    fetchMock.mockResolvedValue(new Response('x', { headers: type ? { 'content-type': type } : {} }));
    expect(await fetchImageRendition('b', 'k', TRANSFORM)).toBeNull();
  });
});
