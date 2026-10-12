import { NextResponse, type NextRequest } from 'next/server';
import { getDeliveryLogoByToken } from '@/lib/engagements/public-logo';
import { portalReadVerdict } from '@/lib/share/portal-rate-limit';
import { PORTAL_RETRY_AFTER_SECONDS } from '@/lib/share/portal-retry-after';
import { LOGO_HEADERS, logoNotFound, logoResponse } from '@/lib/storage/logo-response';

// Round C: the studio's logo on the client page's studio bar. GET only; the
// share token in the path IS the authorization (the SDF resolves the delivery
// by its hash, the logo in-org, and only while the link is live).
//
// Served as the stored original's BYTES, never a storage URL, and every miss is
// the same empty 404 (../../../../../lib/storage/logo-response.ts):
// an unknown, revoked or expired link and a malformed token included, and a
// Worker deployed without its read limiter binding (logged by name). A link
// past its per-link read budget (per data centre,
// ../../../../../lib/share/portal-rate-limit.ts) answers 429. Referrer-Policy
// no-referrer on every answer: the token is in the path.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const verdict = await portalReadVerdict(token);
  if (verdict === 'misdeployed') return logoNotFound();
  if (verdict === 'refused') {
    return new NextResponse(null, {
      status: 429,
      headers: { ...LOGO_HEADERS, 'Cache-Control': 'no-store', 'Retry-After': String(PORTAL_RETRY_AFTER_SECONDS) },
    });
  }
  // Token-free breadcrumb only.
  return logoResponse(() => getDeliveryLogoByToken(token), 'delivery logo failed');
}
