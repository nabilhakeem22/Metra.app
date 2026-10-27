import { describe, expect, it } from 'vitest';
import { homeHref, homePaymentHref, requestedFocus, requestedTab } from './tab';

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

  it('opens a design-fee instalment the client can claim, by its kind (the link of a code email, H5 F1)', () => {
    for (const kind of ['deposit', 'gate_a', 'gate_b', 'balance']) expect(requestedFocus(`instalment:${kind}`)).toEqual({ section: 'instalment', kind });
  });

  it('ignores anything else', () => {
    for (const value of [
      undefined,
      '',
      'payments',
      'variation:',
      'variation:not-a-uuid',
      `variation:${ID}:x`,
      `site:${ID}`,
      ['contract'],
      'instalment:',
      'instalment:retainer',
      'instalment:Deposit',
      'instalment:deposit:x',
      `instalment:${ID}`,
    ]) {
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

describe('homePaymentHref', () => {
  it('opens one payment on its tab: a request on the Execution tab, an instalment on the design tab', () => {
    expect(homePaymentHref('tok', { requestId: ID.toLowerCase() })).toBe(`/d/tok?tab=execution&focus=request:${ID.toLowerCase()}`);
    expect(homePaymentHref('tok', { instalment: 'gate_a' })).toBe('/d/tok?tab=design&focus=instalment:gate_a');
  });

  it('reads back as the focus it names', () => {
    const href = homePaymentHref('tok', { requestId: ID.toLowerCase() });
    expect(requestedFocus(new URL(href, 'https://x.invalid').searchParams.get('focus') ?? undefined)).toEqual({ section: 'request', id: ID.toLowerCase() });
  });
});
