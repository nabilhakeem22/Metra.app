// What the studio may upload as its logo. PURE and CLIENT-SAFE.
//
// The logo is shown on every client page (Wave 3 serves it from there), so it
// must be a plain raster image of bounded size: never SVG (it can carry script),
// never an arbitrary type the uploader declared. Checked twice on the server:
// what the browser SAYS before the upload URL is signed, and what Storage HOLDS
// before the logo is attached.

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const LOGO_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The accept list for a logo picker, from the same table. */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

export type LogoRefusal = 'invalid' | 'file_too_large';

export interface LogoFacts {
  originalName?: string | null;
  contentType?: string | null;
  /** Bytes; undefined when not known yet (before the upload). */
  size?: number | null;
}

function mediaTypeOf(contentType: string | null | undefined): string | null {
  return typeof contentType === 'string' ? contentType.split(';')[0]!.trim().toLowerCase() || null : null;
}

/** The image type a logo file name promises (png, jpg, jpeg, webp), or null. */
function logoTypeOfName(originalName: string | null | undefined): string | null {
  const dot = typeof originalName === 'string' ? originalName.lastIndexOf('.') : -1;
  const extension = dot < 0 ? '' : originalName!.slice(dot + 1).toLowerCase();
  return LOGO_TYPE_BY_EXTENSION[extension] ?? null;
}

/** Whether a stored file's name is one a logo may have: what the studio's own
 *  logo route serves (the client page's SDF applies the same list in SQL). */
export function hasLogoImageName(originalName: string | null | undefined): boolean {
  return logoTypeOfName(originalName) !== null;
}

/** Why this logo is refused, or null when it may be used. */
export function logoRefusal({ originalName, contentType, size }: LogoFacts): LogoRefusal | null {
  const expected = logoTypeOfName(originalName);
  if (!expected || mediaTypeOf(contentType) !== expected) return 'invalid';
  if (size === undefined || size === null) return null;
  if (!Number.isFinite(size) || size <= 0) return 'invalid';
  return size > LOGO_MAX_BYTES ? 'file_too_large' : null;
}
