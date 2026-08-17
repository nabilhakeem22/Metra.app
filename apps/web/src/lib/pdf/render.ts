import 'server-only';

// TODO(cf-migration): rewrite onto @cloudflare/puppeteer (Browser Rendering,
// BROWSER binding). SPIKE STUB ONLY — the previous implementation imported
// @sparticuz/chromium + puppeteer-core, which cannot live in a Workers bundle
// and blocked the OpenNext build. The full Browser Rendering rewrite (plus the
// in-process concurrency throttle it replaced) is deferred and OUT OF SCOPE for
// this de-risk spike. The original puppeteer implementation is in git history
// on `main` (apps/web/src/lib/pdf/render.ts).
export async function renderPdf(_html: string): Promise<Uint8Array> {
  throw new Error('PDF rendering pending Cloudflare Browser Rendering migration');
}
