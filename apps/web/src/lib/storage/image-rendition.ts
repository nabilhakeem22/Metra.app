import 'server-only';
// Serving a DOWNSCALED image without ever handing the browser a storage URL.
//
// Why not redirect to a signed render URL: Storage accepts a token minted for
// /render/image/sign/<bucket>/<key> at /object/sign/<bucket>/<key> too (it
// checks the path and the expiry, not the transform), so a client who edits
// one path segment of a "preview" URL gets the full-resolution original. The
// token therefore stays on the server: it is used once, here, and only the
// rendition's bytes go to the browser. Every route that shows a client a
// reduced image (the payment-gated preview now; the gallery thumbnails and the
// studio logo in Wave 3) must go through this helper.
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
const FETCH_TIMEOUT_MS = 10_000;

export interface ImageRendition {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

/** A pass-through that errors the stream once more than `maxBytes` have gone by. */
function byteCeiling(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) controller.error(new Error('image rendition over its byte ceiling'));
      else controller.enqueue(chunk);
    },
  });
}

/**
 * The transformed image of an ALREADY-AUTHORIZED object, as a stream, or null
 * when Storage did not answer with a bounded image. Streams (never buffers), and
 * stops at `RENDITION_MAX_BYTES`. Throws only on a signing error.
 */
export async function fetchImageRendition(
  bucket: string,
  objectKey: string,
  transform: ImageTransform,
): Promise<ImageRendition | null> {
  const signedUrl = await createSignedObjectUrl(bucket, objectKey, SIGNED_TTL_SECONDS, { transform });
  const upstream = await fetch(signedUrl, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!upstream.ok || !upstream.body) return null;
  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const declaredLength = Number(upstream.headers.get('content-length') ?? Number.NaN);
  if (!RENDITION_TYPES.has(contentType) || declaredLength > RENDITION_MAX_BYTES) {
    await upstream.body.cancel();
    return null;
  }
  return { body: upstream.body.pipeThrough(byteCeiling(RENDITION_MAX_BYTES)), contentType };
}
