import 'server-only';
import { NextResponse } from 'next/server';
import { PREVIEW_MAX_EDGE, PREVIEW_QUALITY } from '@/lib/engagements/document-access';
import type { DeliveryDocumentTarget } from '@/lib/engagements/public-documents';
import { mayOpenInline } from '@/lib/files/inline-view';
import { fetchImageRendition } from '@/lib/storage/image-rendition';
import { storedObjectInfo } from '@/lib/storage/object-info';
import { createSignedObjectUrl } from '@/lib/storage/signed-urls';

/** How the client asked for the file: saved (no variant) or opened (`?variant=view`). */
export type HandOver = 'download' | 'view';

/** How long a PAID client's signed link stays valid: long enough to open a large
 *  PDF and reload its tab, short enough not to be worth passing around. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Every answer of the document route: never cached, never a Referer (the share
 *  token is in the path), never content-sniffed. */
export const DOCUMENT_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

/** The storage-side downscale a PREVIEW is served through, whichever variant. */
const PREVIEW_TRANSFORM = {
  width: PREVIEW_MAX_EDGE,
  height: PREVIEW_MAX_EDGE,
  resize: 'contain',
  quality: PREVIEW_QUALITY,
} as const;

/**
 * The answer for a document the client may have, or null for the route's
 * indistinguishable "unavailable". The object key comes from the `files` row the
 * SDF resolved, never from the request.
 *
 * PREVIEW (money outstanding): the downscaled image's BYTES, streamed from here.
 * No storage URL reaches the browser, because a render-transform token also
 * opens the original object (./lib/storage/image-rendition.ts). A preview that
 * is not an image is refused rather than served whole.
 *
 * DOWNLOAD access: a 300 s signed redirect. With the client-facing name it is
 * saved as an attachment; it opens in the browser only for `view` of a
 * pdf/png/jpg/jpeg whose STORED type matches its extension (./lib/files/inline-view.ts).
 */
export async function documentResponse(
  document: DeliveryDocumentTarget,
  handOver: HandOver,
): Promise<NextResponse | null> {
  if (document.access === 'preview') {
    const rendition = await fetchImageRendition(document.bucket, document.objectKey, PREVIEW_TRANSFORM);
    if (!rendition) return null;
    return new NextResponse(rendition.body, {
      status: 200,
      headers: {
        ...DOCUMENT_HEADERS,
        'Cache-Control': 'private, no-store',
        'Content-Type': rendition.contentType,
        'Content-Disposition': 'inline',
      },
    });
  }
  const opensInline =
    handOver === 'view' &&
    mayOpenInline(document.downloadName, (await storedObjectInfo(document.bucket, document.objectKey))?.contentType);
  const signedUrl = await createSignedObjectUrl(
    document.bucket,
    document.objectKey,
    SIGNED_URL_TTL_SECONDS,
    opensInline ? undefined : { download: document.downloadName },
  );
  return NextResponse.redirect(signedUrl, { status: 302, headers: DOCUMENT_HEADERS });
}
