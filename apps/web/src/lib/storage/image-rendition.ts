import 'server-only';
// Serving a DOWNSCALED image without ever handing the browser a storage URL.
//
// Why not redirect to a signed render URL: Storage accepts a token minted for
// /render/image/sign/<bucket>/<key> at /object/sign/<bucket>/<key> too (it
// checks the path and the expiry, not the transform), so a client who edits
// one path segment of a "preview" URL gets the full-resolution original. The
// token therefore stays on the server: it is used once, here, and only the
// rendition's bytes go to the browser. Every route that shows a client a
// reduced image (the payment-gated preview and the gallery thumbnails) must go
// through this helper. The studio logo is not gated, so it is served as its
// stored original instead (./stored-image.ts).
import { fetchBoundedImage, type BoundedImage } from './bounded-image-fetch';
import { createSignedObjectUrl } from './signed-urls';

export interface ImageTransform {
  width: number;
  height: number;
  resize: 'cover' | 'contain' | 'fill';
  quality: number;
}

/** The image types a rendition may come back as. Anything else (a PDF Storage
 *  could not transform, say) is refused rather than passed through whole. */
const RENDITION_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** A rendition's ceiling. A 1400 px JPEG is well under 1 MB; anything near this
 *  is not a rendition and must not stream through a Worker. */
export const RENDITION_MAX_BYTES = 8 * 1024 * 1024;

/** The server-side token's life: one fetch, right now. */
const SIGNED_TTL_SECONDS = 30;

/**
 * The transformed image of an ALREADY-AUTHORIZED object, as a stream, or null
 * when Storage did not answer with a bounded image. Streams (never buffers), and
 * stops at `RENDITION_MAX_BYTES`. Throws only on a signing error.
 */
export async function fetchImageRendition(
  bucket: string,
  objectKey: string,
  transform: ImageTransform,
): Promise<BoundedImage | null> {
  const signedUrl = await createSignedObjectUrl(bucket, objectKey, SIGNED_TTL_SECONDS, { transform });
  return fetchBoundedImage(signedUrl, { allowedTypes: RENDITION_TYPES, maxBytes: RENDITION_MAX_BYTES });
}
