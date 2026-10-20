import { describe, expect, it } from 'vitest';
import { marketBookSearch, readMarketBookView } from './page-params';

describe('the market book view in the URL', () => {
  it('reads a leaf, a search and a page, anything malformed as its default', () => {
    expect(readMarketBookView({ category: 'finishing.glass', page: '2' })).toEqual({ categoryKey: 'finishing.glass', query: '', page: 2 });
    expect(readMarketBookView({ category: 'finishing', q: '  زجاج ', page: '-3' })).toEqual({ categoryKey: null, query: 'زجاج', page: 1 });
    expect(readMarketBookView({ category: "x.y'; drop", page: '99999' })).toEqual({ categoryKey: null, query: '', page: 1000 });
    expect(readMarketBookView({ q: `a${String.fromCharCode(0)}b` }).query).toBe('ab');
  });

  it('writes a search without its category or page, and a first page bare', () => {
    expect(marketBookSearch({ categoryKey: 'finishing.glass', query: 'pipe', page: 3 })).toBe('?q=pipe');
    expect(marketBookSearch({ categoryKey: 'finishing.glass', query: '', page: 1 })).toBe('?category=finishing.glass');
    expect(marketBookSearch({ categoryKey: 'finishing.glass', query: '', page: 2 })).toBe('?category=finishing.glass&page=2');
    expect(marketBookSearch({ categoryKey: null, query: '', page: 1 })).toBe('');
  });
});
