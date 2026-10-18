import { describe, expect, it } from 'vitest';
import { FIRST_VIEW, MAX_SEARCH_LENGTH, priceBookViewSearch, readPriceBookView } from './page-params';

const SECTION = '0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f';

describe('the price book view in the URL', () => {
  it('reads every filter, and round-trips through the query string', () => {
    const view = readPriceBookView({ q: 'نحاس ٢', section: SECTION, active: '1', page: '3' });
    expect(view).toEqual({ query: 'نحاس ٢', sectionId: SECTION, activeOnly: true, page: 3 });
    expect(readPriceBookView(Object.fromEntries(new URLSearchParams(priceBookViewSearch(view))))).toEqual(view);
  });

  it('the first page with no filter is the bare URL', () => {
    expect(priceBookViewSearch(FIRST_VIEW)).toBe('');
    expect(priceBookViewSearch({ ...FIRST_VIEW, query: '   ' })).toBe('');
  });

  it('reads anything malformed as its default, never as an error', () => {
    expect(readPriceBookView({ section: "x' or 1=1", page: '-2', active: 'yes' })).toEqual(FIRST_VIEW);
    expect(readPriceBookView({ page: '1.5' }).page).toBe(1);
    expect(readPriceBookView({ page: 'abc' }).page).toBe(1);
    expect(readPriceBookView({ page: '99999999' }).page).toBe(10_000);
    expect(readPriceBookView({ q: ['first', 'second'] }).query).toBe('first');
    expect(readPriceBookView({ q: 'x'.repeat(5000) }).query).toHaveLength(MAX_SEARCH_LENGTH);
  });
});
