import { isIndexablePath } from '@/lib/seo/indexable-pages';
import { NOINDEX_DIRECTIVE, ROBOTS_HEADER } from '@/lib/seo/robots-header';

// The headers the middleware stamps on EVERY response it returns, chosen by the
// request path alone. PURE. This is the one place to add a path-driven response
// header, so it stays a single cheap lookup per request (Workers Free plan,
// 10 ms CPU). Responses served as static assets never reach the middleware:
// public/_headers covers those.

/** The response headers for a request path: today, noindex on everything that is not a landing page. */
export function responseHeadersFor(pathname: string): Readonly<Record<string, string>> {
  return isIndexablePath(pathname) ? {} : { [ROBOTS_HEADER]: NOINDEX_DIRECTIVE };
}
