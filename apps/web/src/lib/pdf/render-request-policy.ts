// What a PDF render may fetch (S8, go-live security, and fix round T7). PURE.
//
// Every template embeds what it needs (base64 @font-face fonts, no remote
// image), so a render has no reason to reach the network. Fencing it off means
// one future unescaped field can never make Browser Rendering fetch an attacker
// URL, or the app's own origin, from inside Cloudflare.

/** The only requests a PDF render may make: inline data and the blank document. */
export function isAllowedRenderRequest(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('about:');
}

/** The URL scheme alone, for a log line: the rest of a URL can carry a token. */
export function requestSchemeOf(url: string): string {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase() ?? 'unknown';
}

/**
 * The CSP every PDF template carries right after its charset (fix round T7):
 * the second lock behind the request fence and the render page's JavaScript
 * switch. Nothing may load but inline styles and data: fonts and images, so a
 * future unescaped `<link rel=prefetch>`, script or WebSocket reaches nothing.
 */
export const PDF_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";

/** The tag itself, for the head of every PDF template. */
export const PDF_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PDF_CONTENT_SECURITY_POLICY}" />`;
