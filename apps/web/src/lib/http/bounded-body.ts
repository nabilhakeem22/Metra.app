// A request body read as text, but never more than a set number of bytes.
// Content-Length is only a first answer: it can be absent (a chunked body) or
// lie, so the read itself stops as soon as the bytes passed the cap, without
// decoding or keeping the rest. PURE: reads the request only.

function declaredLength(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null) return null;
  const length = Number(header);
  return Number.isFinite(length) ? length : null;
}

/** The body as UTF-8 text, or null when it is longer than `maxBytes`. */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    received += read.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
