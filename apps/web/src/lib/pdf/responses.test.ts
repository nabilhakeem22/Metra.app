import { afterEach, describe, expect, it, vi } from 'vitest';
import { RendererBusyError } from '@/lib/pdf/renderer-busy';
import { expectRouteHandlerHeaders } from '@/test/route-handler-headers';

// C6: the PDF routes sit under /api, which the middleware never touches, so
// their responses carry the security headers themselves. Status, body and the
// cache rule are what they were.

vi.mock('server-only', () => ({}));

const { json, pdfResponse, renderFailure } = await import('./responses');

afterEach(() => vi.restoreAllMocks());

describe('pdfResponse', () => {
  it('is the same inline, uncached PDF, now unsniffable, referrer-free and framed by this site only', async () => {
    const response = pdfResponse(new Uint8Array([37, 80, 68, 70]), 'P-0001.pdf');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="P-0001.pdf"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70]);
    expectRouteHandlerHeaders(response);
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});

describe('json', () => {
  it('answers the error in the one shape, with the route-handler headers', async () => {
    const response = json('Not found', 404);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
    expectRouteHandlerHeaders(response);
  });

  it('keeps a header the caller adds', () => {
    const response = json('Renderer busy, try again', 503, { 'retry-after': '5' });
    expect(response.headers.get('retry-after')).toBe('5');
    expectRouteHandlerHeaders(response);
  });
});

describe('renderFailure', () => {
  it('a busy renderer is still the retryable 503, and any other failure the 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busy = renderFailure(new RendererBusyError(), 'Proposal');
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('5');
    expect(await busy.json()).toEqual({ error: 'Renderer busy, try again' });
    expectRouteHandlerHeaders(busy);

    const failed = renderFailure(new Error('boom'), 'Proposal');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'PDF generation failed' });
    expectRouteHandlerHeaders(failed);
  });
});
