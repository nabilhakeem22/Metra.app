// The noindex HTTP header. PURE. A header (not only the robots meta tag) so the
// directive also covers a redirect, a 404 and any response without an HTML head.

export const ROBOTS_HEADER = 'X-Robots-Tag';

export const NOINDEX_DIRECTIVE = 'noindex, nofollow';
