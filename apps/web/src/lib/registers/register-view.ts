// Which page of an in-app register (contracts, proposals) is on screen, as it
// reads in the URL (?q=&page=), so a link opens the same page. PURE and
// client-safe: the server page reads it, the search box and the pager write it.
import { cleanSearchQuery } from '@/lib/search/query-input';

/** Rows per register page. */
export const REGISTER_PAGE_SIZE = 25;
/** Longer is not a search anyone types; it is cut, never refused. */
export const MAX_REGISTER_SEARCH_LENGTH = 200;
/** A page number past this is read as this. */
const MAX_PAGE = 10_000;

export interface RegisterView {
  /** The typed search; '' for none. */
  query: string;
  /** 1-based, as asked: the query clamps it to the last page. */
  page: number;
}

/** One page of a register, and where it sits among the rest. */
export interface RegisterPage<Row> {
  rows: Row[];
  /** How many rows match, across every page. */
  total: number;
  /** The page shown: the one asked for, or the last one when it asked past the end. */
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** A search as the server runs it: cleaned and cut, and '' when it is only blanks. */
export function registerSearchQuery(query: string): string {
  const cleaned = cleanSearchQuery(query, MAX_REGISTER_SEARCH_LENGTH);
  return cleaned.trim() === '' ? '' : cleaned;
}

/** The view a URL asks for. Anything malformed reads as its default, never as an error. */
export function readRegisterView(params: SearchParams): RegisterView {
  const page = Number.parseInt(single(params.page), 10);
  return {
    query: registerSearchQuery(single(params.q)),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The query string for a view, defaults left out (the first page is the bare URL). */
export function registerViewSearch(view: RegisterView): string {
  const params = new URLSearchParams();
  const query = registerSearchQuery(view.query);
  if (query !== '') params.set('q', query);
  if (view.page > 1) params.set('page', String(view.page));
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** The page a request for `requestedPage` shows when `total` rows match, and its first row's offset. */
export function registerPageWindow(total: number, requestedPage: number): { page: number; offset: number } {
  const lastPage = Math.max(1, Math.ceil(total / REGISTER_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), lastPage);
  return { page, offset: (page - 1) * REGISTER_PAGE_SIZE };
}
