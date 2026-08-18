import 'server-only';
import puppeteer from '@cloudflare/puppeteer';
import { cfEnv } from '@/lib/cf/context';

// Renders HTML to a PDF buffer via Cloudflare Browser Rendering (the BROWSER
// binding). Each Worker invocation launches and closes its own browser session:
// module state does not span Worker isolates, so the old in-process concurrency
// limiter is gone — Browser Rendering enforces its own per-account concurrency
// (429s past the free-tier cap) and the PDF route already refuses oversized DOMs.
const PAGE_TIMEOUT_MS = 20_000;

export async function renderPdf(html: string): Promise<Uint8Array> {
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
