import { describe, expect, it } from 'vitest';
import {
  MAX_REGISTER_SEARCH_LENGTH,
  readRegisterView,
  registerPageWindow,
  registerSearchQuery,
  registerViewSearch,
} from './register-view';

describe('a register view in the URL', () => {
  it('reads the search and the page, and round-trips through the query string', () => {
    const view = readRegisterView({ q: 'فيلا ٢', page: '3' });
    expect(view).toEqual({ query: 'فيلا ٢', page: 3 });
    expect(readRegisterView(Object.fromEntries(new URLSearchParams(registerViewSearch(view))))).toEqual(view);
  });

  it('the first page with no search is the bare URL', () => {
    expect(registerViewSearch({ query: '', page: 1 })).toBe('');
    expect(registerViewSearch({ query: '   ', page: 1 })).toBe('');
    expect(registerViewSearch({ query: 'tile', page: 1 })).toBe('?q=tile');
    expect(registerViewSearch({ query: '', page: 2 })).toBe('?page=2');
  });

  it('reads anything malformed as its default, never as an error', () => {
    expect(readRegisterView({ page: '-2' })).toEqual({ query: '', page: 1 });
    expect(readRegisterView({ page: '0' }).page).toBe(1);
    expect(readRegisterView({ page: 'abc' }).page).toBe(1);
    expect(readRegisterView({ page: '99999999' }).page).toBe(10_000);
    expect(readRegisterView({ q: ['first', 'second'], page: ['2', '9'] })).toEqual({ query: 'first', page: 2 });
    expect(readRegisterView({ q: 'x'.repeat(5000) }).query).toHaveLength(MAX_REGISTER_SEARCH_LENGTH);
    expect(readRegisterView({ q: '   ' }).query).toBe('');
  });

  it('drops U+0000 from the search, so Postgres never sees it', () => {
    const nul = String.fromCharCode(0);
    expect(registerSearchQuery(`tile${nul}s`)).toBe('tiles');
    expect(registerSearchQuery(nul.repeat(3))).toBe('');
  });
});

describe('registerPageWindow', () => {
  it('pages of 25: page 2 starts at row 26', () => {
    expect(registerPageWindow(340, 2)).toEqual({ page: 2, offset: 25 });
    expect(registerPageWindow(340, 1)).toEqual({ page: 1, offset: 0 });
  });

  it('a page past the end is the last page', () => {
    expect(registerPageWindow(340, 99)).toEqual({ page: 14, offset: 325 });
    expect(registerPageWindow(50, 3)).toEqual({ page: 2, offset: 25 });
  });

  it('nothing matching is page 1', () => {
    expect(registerPageWindow(0, 7)).toEqual({ page: 1, offset: 0 });
    expect(registerPageWindow(0, 1)).toEqual({ page: 1, offset: 0 });
  });

  it('a page below 1 or not a number is page 1', () => {
    expect(registerPageWindow(340, 0)).toEqual({ page: 1, offset: 0 });
    expect(registerPageWindow(340, Number.NaN)).toEqual({ page: 1, offset: 0 });
  });
});
