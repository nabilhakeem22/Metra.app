import { NextResponse } from 'next/server';
import { renderPdf } from '@/lib/pdf/render';
import { buildSpikeHtml } from '@/lib/pdf/template';

// Node runtime (Chromium is not available on the Edge runtime).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const startedAt = Date.now();
  try {
    const html = buildSpikeHtml();
    const pdf = await renderPdf(html);
    const elapsedMs = Date.now() - startedAt;

    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="merta-arabic-spike.pdf"',
        'x-render-ms': String(elapsedMs),
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF render failed';
    return NextResponse.json(
      { error: message, elapsedMs: Date.now() - startedAt },
      { status: 500 },
    );
  }
}
