// The client page's ONE way to address a released document. PURE (no React):
// the documents card and the concept options both build their links here, and
// a unit test pins the shape the download route reads.

/** How the route should hand the file over: `view` opens it in the browser. */
export type DocumentVariant = 'view';

/**
 * `/{locale}/d/{token}/documents/{id}`, plus `?variant=view` for an inline view.
 * No variant is the download (an attachment, or the preview rendition while
 * money is outstanding).
 */
export function documentUrl(
  locale: string,
  token: string,
  documentId: string,
  variant?: DocumentVariant,
): string {
  const path = `/${locale}/d/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}`;
  return variant ? `${path}?variant=${variant}` : path;
}
