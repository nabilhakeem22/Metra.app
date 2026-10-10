import { NextResponse, type NextRequest } from 'next/server';
import { getDeliveryLogoByToken } from '@/lib/engagements/public-logo';
import { PORTAL_RENDITION_THROTTLE, THROTTLE_RETRY_AFTER_SECONDS } from '@/lib/share/token-throttle';
import { LOGO_HEADERS, logoRenditionResponse } from '@/lib/storage/logo-rendition-response';

// Round C: the studio's logo on the client page's studio bar. GET only; the
// share token in the path IS the authorization (the SDF resolves the delivery
// by its hash, the logo in-org, and only while the link is live).
//
// Served as streamed rendition BYTES, never a storage URL, and every miss is
// the same empty 404 (../../../../../lib/storage/logo-rendition-response.ts):
// an unknown, revoked or expired link and a malformed token included. More
// than 300 pictures a minute for one link (per isolate,
// ../../../../../lib/share/token-throttle.ts) answer 429. Referrer-Policy
// no-referrer on every answer: the token is in the path.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  if (!PORTAL_RENDITION_THROTTLE.allow(token)) {
    return new NextResponse(null, {
      status: 429,
      headers: { ...LOGO_HEADERS, 'Cache-Control': 'no-store', 'Retry-After': String(THROTTLE_RETRY_AFTER_SECONDS) },
    });
  }
  // Token-free breadcrumb only.
  return logoRenditionResponse(() => getDeliveryLogoByToken(token), 'delivery logo failed');
}
