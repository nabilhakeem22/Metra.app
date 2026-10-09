// The share token as ONE path segment of a client-page URL. PURE.
//
// Next hands a route its `token` param in whatever encoding the request used,
// so encoding it again would turn `%20` into `%2520`. Decoding first (when the
// value decodes) and encoding once gives the same segment either way.
export function tokenPathSegment(token: string): string {
  let decoded = token;
  try {
    decoded = decodeURIComponent(token);
  } catch {
    // Not valid percent-encoding: it is the raw value.
  }
  return encodeURIComponent(decoded);
}
