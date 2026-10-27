import { describe, expect, it } from 'vitest';
import { homeCodeActHref, homeHref, requestedFocus, requestedTab } from './tab';

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
  it('opens the contract, one change order, one request or the signing of one contract by its id', () => {
    expect(requestedFocus('contract')).toEqual({ section: 'contract' });
    expect(requestedFocus(`variation:${ID}`)).toEqual({ section: 'variation', id: ID.toLowerCase() });
    expect(requestedFocus(`request:${ID}`)).toEqual({ section: 'request', id: ID.toLowerCase() });
    expect(requestedFocus(`sign:${ID}`)).toEqual({ section: 'sign', id: ID.toLowerCase() });
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
      'sign:',
      'sign:not-a-uuid',
      `sign:${ID}:x`,
      'sign:deposit',
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

describe('homeCodeActHref', () => {
  const id = ID.toLowerCase();

  it('opens one act on its tab: a request and a signing on the Execution tab, an instalment on the design tab', () => {
    expect(homeCodeActHref('tok', { purpose: 'claim_request', target: id })).toBe(`/d/tok?tab=execution&focus=request:${id}`);
    expect(homeCodeActHref('tok', { purpose: 'claim_design_payment', target: 'gate_a' })).toBe('/d/tok?tab=design&focus=instalment:gate_a');
    expect(homeCodeActHref('tok', { purpose: 'sign_contract', target: id })).toBe(`/d/tok?tab=execution&focus=sign:${id}`);
  });

  it('reads back as the focus it names', () => {
    const focusOf = (href: string) => requestedFocus(new URL(href, 'https://x.invalid').searchParams.get('focus') ?? undefined);
    expect(focusOf(homeCodeActHref('tok', { purpose: 'claim_request', target: id }))).toEqual({ section: 'request', id });
    expect(focusOf(homeCodeActHref('tok', { purpose: 'sign_contract', target: id }))).toEqual({ section: 'sign', id });
    expect(focusOf(homeCodeActHref('tok', { purpose: 'claim_design_payment', target: 'deposit' }))).toEqual({ section: 'instalment', kind: 'deposit' });
  });
});
