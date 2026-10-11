import { routing } from '@/i18n/routing';
import { tokenPathSegment } from './portal-path';

// The client page's PICTURES (gallery tiles, hero and lightbox images, the
// studio logo). PURE and CLIENT-SAFE.
//
// ONE FIXED LOCALE SEGMENT (Round D, reliability R2): the picture routes do
// not depend on the locale (the documents route uses it only for the page a
// failed DOWNLOAD lands on, which a picture never shows). Building every
// picture URL under the page's own locale made a language switch miss the
// browser cache and re-spend the link's read budget on every picture already
// loaded. One segment keeps the private 240 s cache across a switch for tiles,
// the hero thumbnail, the logo and preview-mode views. ACCEPTED exception: a
// PAID client's lightbox view is a 302 to a signed storage URL, sent no-store
// because a signed URL must never be cached, so each display spends one read.
//
// The middleware skips locale negotiation for these paths
// (isPortalPicturePath): next-intl would otherwise set the visitor's locale
// cookie to this segment on every picture, flipping where an English-reading
// visitor's next unprefixed visit lands.

/** The locale segment every picture URL is built under. */
export const PICTURE_LOCALE = routing.defaultLocale;

const PICTURE_PATH = new RegExp(`^/${PICTURE_LOCALE}/d/[^/]+/(logo|documents/[^/]+)$`);

/** The studio logo on the client page's bar. */
export function portalLogoPath(token: string): string {
  return `/${PICTURE_LOCALE}/d/${tokenPathSegment(token)}/logo`;
}

/** Is this request path a client-page picture (or a document under the picture segment)? */
export function isPortalPicturePath(pathname: string): boolean {
  return PICTURE_PATH.test(pathname);
}
