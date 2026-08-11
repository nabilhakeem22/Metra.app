import 'server-only';

// R4: in-process render concurrency limit so a burst of PDF requests can't spawn
// unbounded Chromium instances. (A pooled/edge throttle stays P0 backlog.)
const MAX_CONCURRENT_RENDERS = 2;
const PAGE_TIMEOUT_MS = 20_000;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_RENDERS) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

export async function renderPdf(html: string): Promise<Uint8Array> {
  await acquire();
  try {
    return await renderPdfInner(html);
  } finally {
    release();
  }
}

// Renders HTML to a PDF buffer. In serverless/production uses puppeteer-core +
// @sparticuz/chromium; in local dev uses full puppeteer (bundled Chromium).
async function renderPdfInner(html: string): Promise<Uint8Array> {
  const serverless =
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    process.env.PDF_SERVERLESS === '1';

  let browser: {
    newPage: () => Promise<any>;
    close: () => Promise<void>;
  };

  if (serverless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = await import('puppeteer-core');
    browser = (await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as never;
  } else {
    // Full puppeteer ships its own Chromium; used for local dev / CI.
    const puppeteer = await import('puppeteer');
    browser = (await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })) as never;
  }

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: PAGE_TIMEOUT_MS,
    });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // eslint-disable-next-line metra/no-physical-inline-direction -- Puppeteer PDF margin API keys, not CSS
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return pdf as Uint8Array;
  } finally {
    await browser.close();
  }
}
