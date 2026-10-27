import { isLocale } from '@/i18n/routing';

// A FILE path outside any locale (/favicon.ico, /fonts/x.ttf, /nope.png).
// PURE. The middleware runs on every path but the API and Next's own files
// (go-live security fix round 2, F3), so a missing file gets the security and
// noindex headers on its 404. It must not get a locale redirect: next dev and
// next start serve public/ AFTER the middleware, and /favicon.ico redirected
// to /ar-EG/favicon.ico is a 404 there. On Cloudflare a real file is a static
// asset served before the Worker runs, so only a missing one gets here.

/** The last segment has an extension: letters or digits after a dot. */
const FILE_NAME = /\/[^/]*\.[A-Za-z0-9]+$/;

/** True for a file path whose first segment is not a locale: the middleware passes it through. */
export function isUnlocalizedFilePath(pathname: string): boolean {
  return FILE_NAME.test(pathname) && !isLocale(pathname.split('/')[1] ?? '');
}
