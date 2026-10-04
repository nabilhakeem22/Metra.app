// The renderer's one RETRYABLE failure, in a module with no renderer in it: the
// cores that render (Send as BOQ, the sheet's Issue) test for it to answer
// `renderer_busy`, and must not load @cloudflare/puppeteer to do so.

/** The renderer was busy (concurrency/429) after every retry — signal a 503. */
export class RendererBusyError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('renderer-busy', options);
    this.name = 'RendererBusyError';
  }
}
