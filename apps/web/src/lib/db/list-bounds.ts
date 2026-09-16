/**
 * The page bounds every in-app register query obeys.
 *
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no db.
 *
 * R5: a list is ALWAYS bounded. An unbounded register streams a firm's entire
 * proposal or contract history into one response the moment a pilot grows past a
 * few hundred rows, and nothing in the UI would notice until it was slow.
 *
 * Deliberately NOT `lib/api/pagination.ts`: that one parses STRING query
 * parameters off a public API request and caps at 100. This is the in-app read
 * path, where the caller is our own server component passing numbers. Two
 * audiences, two ceilings; merging them would silently change one of them.
 */

export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 500;

export interface PageFilter {
  limit?: number;
  offset?: number;
}

/** A limit clamped to [1, 500] and a non-negative offset, whatever came in. */
export function boundedPage(filter: PageFilter): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(filter.limit ?? LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT),
    offset: Math.max(filter.offset ?? 0, 0),
  };
}
