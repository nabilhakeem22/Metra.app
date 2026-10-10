import { NextResponse, type NextRequest } from 'next/server';
import { getDeliveryLogoByToken } from '@/lib/engagements/public-logo';
import { fetchImageRendition, type ImageTransform } from '@/lib/storage/image-rendition';

// Round C: the studio's logo on the client page's studio bar. GET only; the
// share token in the path IS the authorization (the SDF resolves the delivery
// by its hash, the logo in-org, and only while the link is live).
//
// BYTES, NEVER A URL. The logo is streamed from here as a small rendition
// (./lib/storage/image-rendition.ts). A redirect to a signed render URL would
// hand the browser a token that also opens the original object at
// /object/sign/ (the C5 S1 bypass), so no storage URL ever leaves the server.
//
// NO ORACLE: an unknown, revoked or expired link, a malformed token, a studio
// with no logo, a logo that is not an image, a failed rendition and any throw
// all answer the same empty 404.

/** 40 px on screen, sharp at 4x. `contain`: a logo is never cropped. */
const LOGO_TRANSFORM: ImageTransform = { width: 160, height: 160, resize: 'contain', quality: 80 };

/** Every answer: never cached (the link can be revoked), never a Referer
 *  (the token is in the path), never content-sniffed. */
const LOGO_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { ...LOGO_HEADERS, 'Cache-Control': 'no-store' } });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  try {
    const logo = await getDeliveryLogoByToken(token);
    if (!logo) return notFound();
    const rendition = await fetchImageRendition(logo.bucket, logo.objectKey, LOGO_TRANSFORM);
    if (!rendition) return notFound();
    return new NextResponse(rendition.body, {
      status: 200,
      headers: {
        ...LOGO_HEADERS,
        'Cache-Control': 'private, no-store',
        'Content-Type': rendition.contentType,
        'Content-Disposition': 'inline',
      },
    });
  } catch {
    // Token-free breadcrumb only.
    console.error('delivery logo failed');
    return notFound();
  }
}
