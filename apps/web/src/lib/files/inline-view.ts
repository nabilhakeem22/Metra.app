// Which stored files a browser may OPEN rather than save. PURE (no I/O).
//
// Opening a file inline serves it under the Content-Type that was stored with
// it, and that type is whatever the uploading browser declared: a file NAMED
// render.pdf can be stored as image/svg+xml and run script as a page on the
// storage origin. So a file opens inline only when its extension is one of four
// harmless kinds AND the stored type is exactly that kind's type. Anything else
// is handed over as an attachment, which makes it inert.

const INLINE_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** The lower-cased extension after the last dot of a client-facing file name. */
function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : fileName.slice(dot + 1).toLowerCase();
}

/** The media type of a stored Content-Type, without parameters, lower-cased. */
function mediaTypeOf(contentType: string | null | undefined): string | null {
  if (typeof contentType !== 'string') return null;
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();
  return mediaType || null;
}

/** May this file open in the browser? Only pdf/png/jpg/jpeg stored as their own type. */
export function mayOpenInline(fileName: string, storedContentType: string | null | undefined): boolean {
  const extension = extensionOf(fileName);
  const expected = extension ? INLINE_TYPE_BY_EXTENSION[extension] : undefined;
  return expected !== undefined && mediaTypeOf(storedContentType) === expected;
}
