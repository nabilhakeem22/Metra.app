import { describe, expect, it } from 'vitest';
import { homeHref, requestedFocus, requestedTab } from './tab';

const ID = '0F8FAD5B-D9CB-469F-A165-70867728950E';

describe('requestedTab', () => {
  it('names a tab only for the two known values, one string each', () => {
    expect(requestedTab('design')).toBe('design');
    expect(requestedTab('execution')).toBe('execution');
    for (const value of [undefined, '', 'Execution', 'site', ['execution'], ['design', 'execution']]) {
      expect({ value, tab: requestedTab(value) }).toEqual({ value, tab: null });
    }
  });
});

describe('requestedFocus', () => {
  it('opens the contract, one change order or one request by its id', () => {
    expect(requestedFocus('contract')).toEqual({ section: 'contract' });
    expect(requestedFocus(`variation:${ID}`)).toEqual({ section: 'variation', id: ID.toLowerCase() });
    expect(requestedFocus(`request:${ID}`)).toEqual({ section: 'request', id: ID.toLowerCase() });
  });

  it('ignores anything else', () => {
    for (const value of [undefined, '', 'payments', 'variation:', 'variation:not-a-uuid', `variation:${ID}:x`, `site:${ID}`, ['contract']]) {
      expect({ value, focus: requestedFocus(value) }).toEqual({ value, focus: null });
    }
  });
});

describe('homeHref', () => {
  it('writes the tab as the only query', () => {
    expect(homeHref('tok', 'execution')).toBe('/d/tok?tab=execution');
    expect(homeHref('tok', null)).toBe('/d/tok');
  });
});
