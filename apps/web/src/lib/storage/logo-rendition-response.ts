import 'server-only';
// The HTTP answer for a studio logo: the client page's bar (/d/[token]/logo)
// and the studio's own Settings (/settings/logo) both answer through here, so
// the two can never drift on how a logo is served.
//
// BYTES, NEVER A URL. The logo is streamed as its stored ORIGINAL
// (./stored-image.ts): it is not payment-gated, it is at most LOGO_MAX_BYTES of
// png, jpg or webp (checked at upload and again when attached), and the page
// scales it with CSS. The plain object URL is signed and used on the server
// only; no storage URL ever leaves it. (Storage image transformations are not
// on the Supabase plan in use, so a rendition is not an option; docs/DEPLOY.md.)
//
// NO ORACLE: no logo, a logo that is not an image, an oversized or failed fetch
// and any throw all answer the same empty, uncached 404.
import { NextResponse } from 'next/server';
import { LOGO_MAX_BYTES } from '@/lib/org/logo-rules';
import { fetchStoredImage } from './stored-image';

/** Where a logo's object lives. Resolved and authorized by the caller. */
export interface LogoLocation {
  bucket: string;
  objectKey: string;
}

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
 * Resolves the logo and streams its stored bytes, or the empty 404. Never throws:
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
    const image = await fetchStoredImage(logo.bucket, logo.objectKey, LOGO_MAX_BYTES);
    if (!image) return logoNotFound();
    return new NextResponse(image.body, {
      status: 200,
      headers: {
        ...LOGO_HEADERS,
        // The browser may keep it for a few minutes; no shared cache ever may (S2).
        'Cache-Control': 'private, max-age=240',
        'Content-Type': image.contentType,
        'Content-Disposition': 'inline',
      },
    });
  } catch {
    console.error(failureBreadcrumb);
    return logoNotFound();
  }
}
