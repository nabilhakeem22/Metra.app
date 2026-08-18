import 'server-only';
import puppeteer from '@cloudflare/puppeteer';
import { cfEnv } from '@/lib/cf/context';

// Renders HTML to a PDF buffer via Cloudflare Browser Rendering (the BROWSER
// binding). Each Worker invocation launches and closes its own browser session:
// module state does not span Worker isolates, so the old in-process concurrency
// limiter is gone — Browser Rendering enforces its own per-account concurrency
// (429s past the free-tier cap) and the PDF route already refuses oversized DOMs.
// A short bounded retry absorbs a transient concurrency 429; if the renderer is
// still busy after the retries we throw RendererBusyError so the route can return
// a distinct "try again" response instead of a generic 500. (Follow-up: reuse a
// keep-alive Browser Rendering session across requests to raise effective
// throughput — out of scope here.)
const PAGE_TIMEOUT_MS = 20_000;
const MAX_LAUNCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 250;

/** The renderer was busy (concurrency/429) after every retry — signal a 503. */
export class RendererBusyError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('renderer-busy', options);
    this.name = 'RendererBusyError';
  }
}

// A launch/render failure that reads like a concurrency or rate-limit cap (429),
// as opposed to a genuine render error (bad HTML, page timeout). Only these are
// retried and mapped to "busy".
function looksBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Concurrency/rate-limit signals only — NOT generic "timeout … exceeded",
  // which is a real render failure that must fail fast as a 500.
  return /\b429\b|concurren|rate.?limit|too many|capacity/i.test(message);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function renderOnce(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(cfEnv().BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: PAGE_TIMEOUT_MS,
    });
    // Fonts are base64-embedded @font-face (Arabic shaping); wait for them to
    // finish loading so the PDF doesn't rasterise before the webfonts apply.
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // eslint-disable-next-line metra/no-physical-inline-direction -- Puppeteer PDF margin API keys, not CSS
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

export async function renderPdf(html: string): Promise<Uint8Array> {
  let lastBusyError: unknown;
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt += 1) {
    try {
      return await renderOnce(html);
    } catch (error) {
      // A genuine render failure fails fast as a 500 upstream; only a busy/429
      // signal is retried and, if it persists, remapped to RendererBusyError.
      if (!looksBusy(error)) throw error;
      lastBusyError = error;
      if (attempt < MAX_LAUNCH_ATTEMPTS) {
        await delay(RETRY_BACKOFF_MS * attempt);
      }
    }
  }
  throw new RendererBusyError({ cause: lastBusyError });
}
