import { describe, expect, it } from 'vitest';
import { signFailureOf, signFailureRefreshes } from './contract-sign-failure';

describe('signFailureOf: a refused signing as the section says it', () => {
  it('keeps the closed window its own, reads a contract that is not the home one as moved on, the rest as portal failures', () => {
    expect(signFailureOf({ ok: false, error: 'signing_closed' })).toEqual({ error: 'signing_closed' });
    expect(signFailureOf({ ok: false, error: 'wrong_target' })).toEqual({ error: 'wrong_state' });
    expect(signFailureOf({ ok: false, error: 'contract_inactive' })).toEqual({ error: 'wrong_state' });
    expect(signFailureOf({ ok: false, error: 'token_expired' })).toEqual({ error: 'token_expired' });
    expect(signFailureOf({ ok: false, error: 'not_active' })).toEqual({ error: 'not_active' });
    expect(signFailureOf({ ok: false, error: 'uncertain' })).toEqual({ error: 'uncertain' });
    expect(signFailureOf({ ok: false, error: 'generic', reference: 'AB12CD34' })).toEqual({ error: 'generic', reference: 'AB12CD34' });
    expect(signFailureOf({ ok: false, error: 'link_expired' })).toEqual({ error: 'generic' });
  });

  it('reads the page again only after the contract moved, or after an answer that never came', () => {
    expect([{ error: 'signing_closed' }, { error: 'wrong_state' }, { error: 'uncertain' }].every((failure) => signFailureRefreshes(failure as never))).toBe(true);
    expect([{ error: 'token_expired' }, { error: 'generic' }, { error: 'not_active' }].some((failure) => signFailureRefreshes(failure as never))).toBe(false);
  });
});
