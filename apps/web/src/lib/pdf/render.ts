import 'server-only';

// Renders HTML to a PDF buffer. In serverless/production uses puppeteer-core +
// @sparticuz/chromium; in local dev uses full puppeteer (bundled Chromium).
export async function renderPdf(html: string): Promise<Uint8Array> {
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
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // eslint-disable-next-line merta/no-physical-inline-direction -- Puppeteer PDF margin API keys, not CSS
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return pdf as Uint8Array;
  } finally {
    await browser.close();
  }
}
