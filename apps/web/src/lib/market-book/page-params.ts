// Which part of the market book is on screen, as it reads in the URL
// (?category=<leaf key> or ?q=), so a link opens the same list. PURE and
// client-safe: the server page reads it, the rail and the search box write it.
import { cleanSearchQuery } from '@/lib/search/query-input';

/** Longer is not a search anyone types; it is cut, never refused. */
export const MARKET_SEARCH_MAX_LENGTH = 200;
/** Items one category shows (the largest leaf of July 2026 holds 52). */
export const MARKET_CATEGORY_LIMIT = 100;
/** Items one search shows; how many matched is said beside them. */
export const MARKET_SEARCH_LIMIT = 50;

/** A leaf of the taxonomy ('finishing.glass'); anything else is no category. */
const LEAF_KEY = /^[a-z_]+\.[a-z_]+$/;

export interface MarketBookView {
  /** The leaf asked for; null (or one with no item) shows the first leaf that has items. */
  categoryKey: string | null;
  /** A search across every category; it wins over the category when both are given. */
  query: string;
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The view a URL asks for. Anything malformed reads as its default, never as an error. */
export function readMarketBookView(params: SearchParams): MarketBookView {
  const category = single(params.category);
  return {
    categoryKey: LEAF_KEY.test(category) ? category : null,
    query: cleanSearchQuery(single(params.q), MARKET_SEARCH_MAX_LENGTH).trim(),
  };
}

/** The query string of a view, defaults left out. */
export function marketBookSearch(view: MarketBookView): string {
  const params = new URLSearchParams();
  if (view.query !== '') params.set('q', view.query);
  else if (view.categoryKey) params.set('category', view.categoryKey);
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}
