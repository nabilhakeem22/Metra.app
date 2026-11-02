import { describe, expect, it, vi } from 'vitest';
import { decideFailureOf, decideFailureRefreshes, describeDecideFailure } from './change-order-decide-failure';

// H7.1: what a refused decision says in the section, and which refusals read the
// page again: the order moved on, the window closed, or the answer was lost.

describe('decideFailureOf', () => {
  it.each([
    ['link_expired', { error: 'reply_closed' }],
    ['wrong_target', { error: 'wrong_state' }],
    ['contract_inactive', { error: 'wrong_state' }],
    ['token_invalid', { error: 'token_invalid' }],
    ['token_expired', { error: 'token_expired' }],
    ['not_active', { error: 'not_active' }],
    ['uncertain', { error: 'uncertain' }],
  ] as const)('%s is %j', (error, shown) => {
    expect(decideFailureOf({ ok: false, error } as never)).toEqual(shown);
  });

  it('generic keeps its reference', () => {
    expect(decideFailureOf({ ok: false, error: 'generic', reference: 'R1' })).toEqual({ error: 'generic', reference: 'R1' });
  });
});

describe('decideFailureRefreshes', () => {
  it.each(['reply_closed', 'wrong_state', 'uncertain'] as const)('%s reads the page again', (error) => {
    expect(decideFailureRefreshes({ error })).toBe(true);
  });

  it.each(['token_invalid', 'token_expired', 'not_active', 'generic'] as const)('%s does not', (error) => {
    expect(decideFailureRefreshes({ error })).toBe(false);
  });
});

describe('describeDecideFailure', () => {
  const tErrors = vi.fn((key: string) => `errors.${key}`) as never;

  it('the closed window and an order that moved on in the section own words; the rest from portal.errors', () => {
    const own = (key: string) => `own.${key}`;
    expect(describeDecideFailure({ error: 'reply_closed' }, tErrors, own)).toBe('own.replyClosed');
    expect(describeDecideFailure({ error: 'wrong_state' }, tErrors, own)).toBe('own.movedOn');
    expect(describeDecideFailure({ error: 'token_invalid' }, tErrors, own)).toBe('errors.token_invalid');
  });
});
