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

/** A fake intercepted request: its URL, and what the fence answered. */
function fakeRequest(url: string) {
  return { url: () => url, continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
}

// A fake browser whose page produces a fixed PDF buffer, records the order of
// the calls that matter, and keeps the request handler the fence registers.
function fakeBrowser() {
  const close = vi.fn(async () => {});
  const calls: string[] = [];
  const requestHandlers: Array<(request: ReturnType<typeof fakeRequest>) => void> = [];
  return {
    close,
    calls,
    requestHandlers,
    newPage: async () => ({
      setRequestInterception: async (enabled: boolean) => {
        calls.push(`setRequestInterception:${enabled}`);
      },
      on: (event: string, handler: (request: ReturnType<typeof fakeRequest>) => void) => {
        calls.push(`on:${event}`);
        requestHandlers.push(handler);
      },
      setContent: async () => {
        calls.push('setContent');
      },
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

describe('renderPdf: the network fence (S8)', () => {
  async function renderedWithFence() {
    const browser = fakeBrowser();
    launch.mockResolvedValueOnce(browser);
    await renderPdf('<html></html>');
    return browser;
  }

  it('turns interception on and registers the handler before setContent', async () => {
    const { calls } = await renderedWithFence();
    expect(calls).toEqual(['setRequestInterception:true', 'on:request', 'setContent']);
  });

  it('aborts an https request and logs its scheme only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { requestHandlers } = await renderedWithFence();
    const request = fakeRequest('https://collector.test/x.png?token=SECRET');
    requestHandlers[0]?.(request);
    await vi.waitFor(() => expect(request.abort).toHaveBeenCalledWith('blockedbyclient'));
    expect(request.continue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('pdf render blocked a request', { scheme: 'https' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('collector.test');
    warn.mockRestore();
  });

  it('lets a data: request through', async () => {
    const { requestHandlers } = await renderedWithFence();
    const request = fakeRequest('data:font/ttf;base64,AA');
    requestHandlers[0]?.(request);
    await vi.waitFor(() => expect(request.continue).toHaveBeenCalledTimes(1));
    expect(request.abort).not.toHaveBeenCalled();
  });
});
