import { describe, expect, it } from 'vitest';
import { MAX_JSON_BODY_BYTES, readSameOriginJson } from './same-origin-json';

// The sign-in routes' body gate: same-origin JSON only, and never more than
// MAX_JSON_BODY_BYTES of it, whether Content-Length is honest, absent or a lie.

const SITE_HEADERS = { origin: 'https://metra.app', host: 'metra.app', 'content-type': 'application/json' };

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('https://metra.app/api/auth/otp/send', {
    method: 'POST',
    headers: { ...SITE_HEADERS, ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
}

/** A JSON document of exactly `bytes` UTF-8 bytes. */
function jsonOfBytes(bytes: number, filler = 'a'): string {
  const frame = JSON.stringify({ identifier: '' });
  const fillerBytes = new TextEncoder().encode(filler).byteLength;
  return JSON.stringify({ identifier: filler.repeat((bytes - frame.length) / fillerBytes) });
}

/** A body with no Content-Length: chunks of `chunkBytes`, `chunks` times. */
function chunkedBody(chunkBytes: number, chunks: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) return controller.close();
      pulled += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  });
  return { stream, pulled: () => pulled };
}

describe('readSameOriginJson', () => {
  it('parses a same-origin JSON body', async () => {
    expect(await readSameOriginJson(post('{"channel":"email"}'))).toEqual({ kind: 'ok', body: { channel: 'email' } });
  });

  it('refuses a foreign Origin before the body is read', async () => {
    const request = post('{}', { origin: 'https://evil.example' });
    expect(await readSameOriginJson(request)).toEqual({ kind: 'forbidden' });
    expect(request.bodyUsed).toBe(false);
  });

  it('accepts a body of exactly the cap', async () => {
    const body = jsonOfBytes(MAX_JSON_BODY_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_JSON_BODY_BYTES);
    expect((await readSameOriginJson(post(body))).kind).toBe('ok');
  });

  it('answers a body one byte over the cap malformed', async () => {
    expect(await readSameOriginJson(post(jsonOfBytes(MAX_JSON_BODY_BYTES + 2)))).toEqual({ kind: 'malformed' });
  });

  it('counts bytes, not characters: Arabic text over the cap in bytes is malformed', async () => {
    const arabic = jsonOfBytes(MAX_JSON_BODY_BYTES + 2, 'ع');
    expect(arabic.length).toBeLessThan(MAX_JSON_BODY_BYTES);
    expect(await readSameOriginJson(post(arabic))).toEqual({ kind: 'malformed' });
  });

  it('refuses a declared Content-Length over the cap without reading the body', async () => {
    const request = post('{}', { 'content-length': String(MAX_JSON_BODY_BYTES + 1) });
    expect(await readSameOriginJson(request)).toEqual({ kind: 'malformed' });
    expect(request.bodyUsed).toBe(false);
  });

  it('refuses a body larger than the Content-Length it declares', async () => {
    const request = post(jsonOfBytes(MAX_JSON_BODY_BYTES * 4), { 'content-length': '20' });
    expect(request.headers.get('content-length')).toBe('20');
    expect(await readSameOriginJson(request)).toEqual({ kind: 'malformed' });
  });

  it('refuses a chunked body with no Content-Length once it passes the cap, and stops reading', async () => {
    const { stream, pulled } = chunkedBody(1024, 1000);
    const request = post(stream);
    expect(request.headers.get('content-length')).toBeNull();
    expect(await readSameOriginJson(request)).toEqual({ kind: 'malformed' });
    expect(pulled()).toBeLessThan(10);
  });

  it('answers an empty body malformed', async () => {
    expect(await readSameOriginJson(post(''))).toEqual({ kind: 'malformed' });
  });
});
