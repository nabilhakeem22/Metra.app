import 'server-only';
// Serving a stored image's ORIGINAL bytes without ever handing the browser a
// storage URL. For an image that is NOT payment-gated and is small by rule (the
// studio logo: png, jpg or webp, at most 2 MB, its stored type checked when it
// is attached): there is no smaller rendition to protect, so signing the plain
// object URL server-side reveals nothing the caller may not already have. The
// browser still never gets any storage URL: the token lives 30 s, is used once,
// here, and only the bytes leave the server.
//
// Not for a gated image (a preview while money is outstanding, say): that one
// must go through ./image-rendition.ts, or the original is handed over whole.
import { fetchBoundedImage, type BoundedImage } from './bounded-image-fetch';
import { createSignedObjectUrl } from './signed-urls';

/** The types a stored original may be served as. Never SVG (it can carry
 *  script), never anything the uploader merely declared. */
const STORED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** The server-side token's life: one fetch, right now. */
const SIGNED_TTL_SECONDS = 30;

/**
 * The stored original of an ALREADY-AUTHORIZED, ungated image object, as a
 * stream, or null when Storage did not answer with a png, jpeg or webp of at
 * most `maxBytes` (declared or streamed). Throws only on a signing error.
 */
export async function fetchStoredImage(
  bucket: string,
  objectKey: string,
  maxBytes: number,
): Promise<BoundedImage | null> {
  const signedUrl = await createSignedObjectUrl(bucket, objectKey, SIGNED_TTL_SECONDS);
  return fetchBoundedImage(signedUrl, { allowedTypes: STORED_IMAGE_TYPES, maxBytes });
}
