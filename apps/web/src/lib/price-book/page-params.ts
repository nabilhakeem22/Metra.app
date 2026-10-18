// Which page of the price book is on screen, as it reads in the URL
// (?q=&section=&active=1&page=), so a link opens the same page. PURE and
// client-safe: the server page reads it, the toolbar and the pager write it.
import { isUuid } from '@/lib/uuid';

/** Rows per page: one page of a 2,000-item book renders like a 50-item book. */
export const PRICE_BOOK_PAGE_SIZE = 50;
/** Longer is not a search anyone types; it is cut, never refused. */
export const MAX_SEARCH_LENGTH = 200;
/** A page number past this is read as this (the book holds low thousands). */
const MAX_PAGE = 10_000;

export interface PriceBookView {
  query: string;
  /** A section id, or null for every section. */
  sectionId: string | null;
  /** Hide retired items. Off by default: the book is a catalogue. */
  activeOnly: boolean;
  /** 1-based. */
  page: number;
}

export const FIRST_VIEW: PriceBookView = { query: '', sectionId: null, activeOnly: false, page: 1 };

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** The view a URL asks for. Anything malformed reads as its default, never as an error. */
export function readPriceBookView(params: SearchParams): PriceBookView {
  const section = single(params.section);
  const page = Number.parseInt(single(params.page), 10);
  return {
    query: single(params.q).slice(0, MAX_SEARCH_LENGTH),
    sectionId: isUuid(section) ? section.toLowerCase() : null,
    activeOnly: single(params.active) === '1',
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The query string for a view, defaults left out (the first page is the bare URL). */
export function priceBookViewSearch(view: PriceBookView): string {
  const params = new URLSearchParams();
  if (view.query.trim() !== '') params.set('q', view.query);
  if (view.sectionId) params.set('section', view.sectionId);
  if (view.activeOnly) params.set('active', '1');
  if (view.page > 1) params.set('page', String(view.page));
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}
