// Which part of the market book is on screen, as it reads in the URL
// (?category=<leaf key>&page=, or ?q=), so a link opens the same list. PURE and
// client-safe: the server page reads it, the rail, the pager and the search box
// write it.
import { cleanSearchQuery } from '@/lib/search/query-input';

/** Longer is not a search anyone types; it is cut, never refused. */
export const MARKET_SEARCH_MAX_LENGTH = 200;
/**
 * Items one page shows: a page of a category, or the first matches of a search.
 * The price book's page size, so a page costs the Worker the same however large
 * a category grows (the largest leaf of July 2026 holds 52).
 */
export const MARKET_PAGE_SIZE = 50;
/** A page number past this is read as this. */
const MAX_PAGE = 1_000;

/** A leaf of the taxonomy ('finishing.glass'); anything else is no category. */
const LEAF_KEY = /^[a-z_]+\.[a-z_]+$/;

export interface MarketBookView {
  /** The leaf asked for; null (or one with no item) shows the first leaf that has items. */
  categoryKey: string | null;
  /** A search across every category; it wins over the category when both are given. */
  query: string;
  /** 1-based page of the category; a search shows its first page only. */
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The view a URL asks for. Anything malformed reads as its default, never as an error. */
export function readMarketBookView(params: SearchParams): MarketBookView {
  const category = single(params.category);
  const page = Number.parseInt(single(params.page), 10);
  return {
    categoryKey: LEAF_KEY.test(category) ? category : null,
    query: cleanSearchQuery(single(params.q), MARKET_SEARCH_MAX_LENGTH).trim(),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The query string of a view, defaults left out. */
export function marketBookSearch(view: MarketBookView): string {
  const params = new URLSearchParams();
  if (view.query !== '') params.set('q', view.query);
  else if (view.categoryKey) params.set('category', view.categoryKey);
  if (view.query === '' && view.page > 1) params.set('page', String(view.page));
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}
