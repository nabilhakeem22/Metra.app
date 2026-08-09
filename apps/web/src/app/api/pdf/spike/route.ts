import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { renderPdf } from '@/lib/pdf/render';
import { buildSpikeHtml } from '@/lib/pdf/template';

// Node runtime (Chromium is not available on the Edge runtime).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  // The i18n middleware matcher skips /api, so this endpoint must gate itself.
  // Require an authenticated session BEFORE launching Chromium — no anonymous
  // render surface. (In-org authorization is enforced on the real document
  // endpoints in P1; this spike only needs to be non-public.)
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const html = buildSpikeHtml();
    const pdf = await renderPdf(html);
    const elapsedMs = Date.now() - startedAt;

    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="metra-arabic-spike.pdf"',
        'x-render-ms': String(elapsedMs),
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    // Log detail server-side; return a generic message to the client.
    console.error('PDF spike render failed:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
