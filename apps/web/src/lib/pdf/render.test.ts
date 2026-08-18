import { beforeEach, describe, expect, it, vi } from 'vitest';

// renderPdf is server-only and drives Cloudflare Browser Rendering via the
// BROWSER binding. Stub server-only + cf/context and mock puppeteer.launch so the
// retry/branching (B2) runs without the live binding. Each test controls how many
// launches fail and with what error.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({
  cfEnv: () => ({ BROWSER: { marker: 'browser-binding' } }),
}));

const launch = vi.fn();
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: (b: unknown) => launch(b) } }));

const { renderPdf, RendererBusyError } = await import('./render');

const PDF_BYTES = new Uint8Array([1, 2, 3]);

// A fake browser whose page produces a fixed PDF buffer.
function fakeBrowser() {
  const close = vi.fn(async () => {});
  return {
    close,
    newPage: async () => ({
      setContent: async () => {},
      evaluateHandle: async () => {},
      pdf: async () => PDF_BYTES,
    }),
  };
}

const busyError = () => new Error('Browser Rendering: 429 concurrent limit exceeded');

beforeEach(() => {
  launch.mockReset();
});

describe('renderPdf — Browser Rendering retry (B2)', () => {
  it('retries a transient 429 and succeeds on a later attempt', async () => {
    const browser = fakeBrowser();
    launch
      .mockRejectedValueOnce(busyError())
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce(browser);

    const pdf = await renderPdf('<html></html>');
    expect(pdf).toEqual(PDF_BYTES);
    expect(launch).toHaveBeenCalledTimes(3);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('throws RendererBusyError when every attempt is busy', async () => {
    launch.mockRejectedValue(busyError());
    await expect(renderPdf('<html></html>')).rejects.toBeInstanceOf(
      RendererBusyError,
    );
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it('does not retry or remap a genuine render failure', async () => {
    // A page timeout is a real render failure, not a concurrency signal: it must
    // fail fast (single attempt) and propagate unchanged for a 500 upstream.
    const renderFailure = new Error('Navigation timeout of 20000 ms exceeded');
    launch.mockRejectedValue(renderFailure);
    await expect(renderPdf('<html></html>')).rejects.toBe(renderFailure);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('closes the browser even when rendering succeeds first try', async () => {
    const browser = fakeBrowser();
    launch.mockResolvedValueOnce(browser);
    await renderPdf('<html></html>');
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
