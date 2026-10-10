import 'server-only';
// Fetching an image from Storage through a short-lived signed URL, server-side,
// as a BOUNDED stream: one shape for the transformed rendition
// (./image-rendition.ts) and the stored original (./stored-image.ts), so the
// two can never drift on what they let through. The URL is used once, here;
// only the bytes reach the caller, never the URL and never a redirect.

const FETCH_TIMEOUT_MS = 10_000;

export interface BoundedImage {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

export interface ImageLimits {
  /** The media types the answer may carry. Anything else is refused. */
  allowedTypes: ReadonlySet<string>;
  /** Refused when declared above it; the stream errors once past it. */
  maxBytes: number;
}

/** A pass-through that errors the stream once more than `maxBytes` have gone by. */
function byteCeiling(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) controller.error(new Error('image over its byte ceiling'));
      else controller.enqueue(chunk);
    },
  });
}

/**
 * The image at `signedUrl` as a stream, or null when Storage did not answer
 * with an allowed, bounded image. `redirect: 'error'`: a redirect is never
 * followed, so the fetch cannot be bounced elsewhere. Streams (never buffers)
 * and stops at `maxBytes` even when the length was not declared.
 */
export async function fetchBoundedImage(signedUrl: string, limits: ImageLimits): Promise<BoundedImage | null> {
  const upstream = await fetch(signedUrl, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!upstream.ok || !upstream.body) return null;
  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const declaredLength = Number(upstream.headers.get('content-length') ?? Number.NaN);
  if (!limits.allowedTypes.has(contentType) || declaredLength > limits.maxBytes) {
    await upstream.body.cancel();
    return null;
  }
  return { body: upstream.body.pipeThrough(byteCeiling(limits.maxBytes)), contentType };
}
