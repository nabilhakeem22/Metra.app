import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('./signed-urls', () => storage);

const { fetchStoredImage } = await import('./stored-image');

const OBJECT_SIGNED = 'https://storage.test/object/sign/b/k?token=O';
const MAX_BYTES = 2 * 1024 * 1024;
const fetchMock = vi.fn();

/** A body that streams `total` bytes in 256 KB chunks and declares no length. */
function streamOf(total: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= total) return controller.close();
      const size = Math.min(256 * 1024, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

beforeEach(() => {
  storage.createSignedObjectUrl.mockReset().mockResolvedValue(OBJECT_SIGNED);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchStoredImage', () => {
  it('signs the plain object for 30 s (no transform, no download name), fetches it without following redirects, and streams it', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(10), { headers: { 'content-type': 'image/PNG; charset=binary' } }));
    const image = await fetchStoredImage('b', 'k', MAX_BYTES);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('b', 'k', 30);
    expect(fetchMock).toHaveBeenCalledWith(
      OBJECT_SIGNED,
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    expect(image?.contentType).toBe('image/png');
    expect((await new Response(image!.body).arrayBuffer()).byteLength).toBe(10);
  });

  it('hands back only the bytes and their type: never the URL, never a Location', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(3), { headers: { 'content-type': 'image/webp' } }));
    const image = await fetchStoredImage('b', 'k', MAX_BYTES);
    expect(Object.keys(image!).sort()).toEqual(['body', 'contentType']);
    expect(JSON.stringify(image)).not.toContain('storage.test');
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'])('serves a stored %s', async (type) => {
    fetchMock.mockResolvedValue(new Response('x', { headers: { 'content-type': type } }));
    expect((await fetchStoredImage('b', 'k', MAX_BYTES))?.contentType).toBe(type);
  });

  it.each(['image/svg+xml', 'image/avif', 'image/gif', 'text/html', 'application/pdf', 'application/octet-stream', ''])(
    'refuses a stored %j',
    async (type) => {
      fetchMock.mockResolvedValue(new Response('x', { headers: type ? { 'content-type': type } : {} }));
      expect(await fetchStoredImage('b', 'k', MAX_BYTES)).toBeNull();
    },
  );

  it('refuses an object that declares more than the ceiling, and cancels its body unread', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_BYTES + 1) } }),
    );
    expect(await fetchStoredImage('b', 'k', MAX_BYTES)).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it('serves an object of exactly the ceiling', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(MAX_BYTES), { headers: { 'content-type': 'image/jpeg' } }));
    const image = await fetchStoredImage('b', 'k', MAX_BYTES);
    expect((await new Response(image!.body).arrayBuffer()).byteLength).toBe(MAX_BYTES);
  });

  it('a body that runs past the ceiling without declaring it errors instead of streaming on', async () => {
    fetchMock.mockResolvedValue(new Response(streamOf(MAX_BYTES + 1), { headers: { 'content-type': 'image/jpeg' } }));
    const image = await fetchStoredImage('b', 'k', MAX_BYTES);
    await expect(new Response(image!.body).arrayBuffer()).rejects.toThrow();
  });

  it.each([302, 400, 403, 404, 500])('a %i from Storage is no image', async (status) => {
    fetchMock.mockResolvedValue(
      new Response('no', { status, headers: { 'content-type': 'image/png', location: 'https://elsewhere.test/' } }),
    );
    expect(await fetchStoredImage('b', 'k', MAX_BYTES)).toBeNull();
  });

  it('a redirect the fetch refuses, or a timeout, throws (the caller answers its 404)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: unexpected redirect'));
    await expect(fetchStoredImage('b', 'k', MAX_BYTES)).rejects.toThrow('unexpected redirect');
  });

  it('a signing error throws before anything is fetched', async () => {
    storage.createSignedObjectUrl.mockRejectedValue(new Error('storage down'));
    await expect(fetchStoredImage('b', 'k', MAX_BYTES)).rejects.toThrow('storage down');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
