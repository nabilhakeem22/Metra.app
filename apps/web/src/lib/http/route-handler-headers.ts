// The security headers EVERY /api route handler puts on EVERY answer.
//
// The middleware's matcher excludes /api, and must keep excluding it (Worker
// CPU: the middleware must not run on those requests), so the headers a page
// gets from lib/http/security-headers.ts never reach an /api response. Each
// handler sets these two itself. PURE, and it imports nothing: a handler pays
// for two header names, not for the page profiles and their CSP strings.

/** Never sniffed as anything but its declared type; no Referer carried to another site. */
export const ROUTE_HANDLER_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
