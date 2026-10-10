import 'server-only';
// The HTTP answer for a studio logo: the client page's bar (/d/[token]/logo)
// and the studio's own Settings (/settings/logo) both answer through here, so
// the two can never drift on how a logo is served.
//
// BYTES, NEVER A URL. The logo is streamed as a small rendition
// (./image-rendition.ts). A redirect to a signed render URL would hand the
// browser a token that also opens the original object at /object/sign/ (the
// C5 S1 bypass), so no storage URL ever leaves the server.
//
// NO ORACLE: no logo, a logo that is not an image, a failed rendition and any
// throw all answer the same empty, uncached 404.
import { NextResponse } from 'next/server';
import { fetchImageRendition, type ImageTransform } from './image-rendition';

/** Where a logo's object lives. Resolved and authorized by the caller. */
export interface LogoLocation {
  bucket: string;
  objectKey: string;
}

/** 40 px on screen, sharp at 4x. `contain`: a logo is never cropped. */
const LOGO_TRANSFORM: ImageTransform = { width: 160, height: 160, resize: 'contain', quality: 80 };

/** Every answer: never a Referer, never content-sniffed. Caching is per
 *  answer: a miss never, the image privately. */
export const LOGO_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function logoNotFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { ...LOGO_HEADERS, 'Cache-Control': 'no-store' } });
}

/**
 * Resolves the logo and streams its rendition, or the empty 404. Never throws:
 * a failure logs `failureBreadcrumb` (a fixed string, so nothing the caller
 * holds, a share token say, can reach the log) and answers the 404. The
 * caller authenticates BEFORE this, so an auth redirect is never swallowed.
 */
export async function logoRenditionResponse(
  resolveLogo: () => Promise<LogoLocation | null>,
  failureBreadcrumb: string,
): Promise<NextResponse> {
  try {
    const logo = await resolveLogo();
    if (!logo) return logoNotFound();
    const rendition = await fetchImageRendition(logo.bucket, logo.objectKey, LOGO_TRANSFORM);
    if (!rendition) return logoNotFound();
    return new NextResponse(rendition.body, {
      status: 200,
      headers: {
        ...LOGO_HEADERS,
        // The browser may keep it for a few minutes; no shared cache ever may (S2).
        'Cache-Control': 'private, max-age=240',
        'Content-Type': rendition.contentType,
        'Content-Disposition': 'inline',
      },
    });
  } catch {
    console.error(failureBreadcrumb);
    return logoNotFound();
  }
}
