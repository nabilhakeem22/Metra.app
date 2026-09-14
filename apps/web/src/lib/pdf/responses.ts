import 'server-only';
// The responses a PDF route sends, and the two rules they carry: the internal
// copy is never cached, and a busy renderer is retryable rather than broken.
import { NextResponse } from 'next/server';
import { RendererBusyError } from '@/lib/pdf/render';

/** Every non-PDF answer this route family gives, in one shape. */
export const json = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

export function pdfResponse(pdf: Uint8Array, fileName: string): Response {
  return new NextResponse(pdf as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fileName}"`,
      // The internal copy carries the firm's margin: never cached, not even
      // privately, so it cannot be read back off a shared machine's disk.
      'cache-control': 'no-store',
    },
  });
}

export function renderFailure(cause: unknown, logLabel: string): Response {
  if (cause instanceof RendererBusyError) {
    // The renderer is at its concurrency cap after retries. A retryable 503 with
    // retry-after, not a 500 — the caller should back off, not give up.
    console.error(`${logLabel} PDF renderer busy:`, cause);
    return json('Renderer busy, try again', 503, { 'retry-after': '5' });
  }
  console.error(`${logLabel} PDF render failed:`, cause);
  return json('PDF generation failed', 500);
}
