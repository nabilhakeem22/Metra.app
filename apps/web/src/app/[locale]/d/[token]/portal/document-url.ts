// The client page's ONE way to address a released document. PURE (no React):
// the documents card and the concept options both build their links here, and
// a unit test pins the shape the download route reads.
import { tokenPathSegment } from '@/lib/engagements/portal-path';

/** How the route should hand the file over: `view` opens it in the browser,
 *  `thumb` is an image's gallery tile (streamed, never a storage URL). */
export type DocumentVariant = 'view' | 'thumb';

/**
 * `/{locale}/d/{token}/documents/{id}`, plus `?variant=view` for an inline view
 * or `?variant=thumb` for a gallery tile.
 * No variant is the download (an attachment, or the preview rendition while
 * money is outstanding).
 */
export function documentUrl(
  locale: string,
  token: string,
  documentId: string,
  variant?: DocumentVariant,
): string {
  const path = `/${locale}/d/${tokenPathSegment(token)}/documents/${encodeURIComponent(documentId)}`;
  return variant ? `${path}?variant=${variant}` : path;
}
