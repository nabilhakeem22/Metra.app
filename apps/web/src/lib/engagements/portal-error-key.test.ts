import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { isSharedPortalError } from '@/lib/share/portal-failure';
import { actFailureOf, portalErrorKey } from './portal-error-key';

describe('portalErrorKey', () => {
  it('keeps the codes the portal has copy for', () => {
    for (const code of ['token_invalid', 'token_expired', 'not_active', 'wrong_state', 'too_many', 'uncertain']) {
      expect(portalErrorKey(code)).toBe(code);
    }
  });

  it('says what a known code means, never generic (F12)', () => {
    expect(portalErrorKey('already_responded')).toBe('wrong_state');
    expect(portalErrorKey('contract_inactive')).toBe('not_active');
  });

  it('folds only a code nobody sent, or none, into generic, keeping the reference', () => {
    expect(portalErrorKey('x')).toBe('generic');
    expect(portalErrorKey(undefined)).toBe('generic');
    expect(portalErrorKey(null)).toBe('generic');
    expect(actFailureOf({ error: 'generic', reference: 'K7Q29MXD' })).toEqual({ error: 'generic', reference: 'K7Q29MXD' });
  });

  it('only ever answers a key portal.errors holds, or wrong_state, which each act says itself', () => {
    const codes = ['token_invalid', 'token_expired', 'not_active', 'wrong_state', 'too_many', 'uncertain', 'x', undefined];
    for (const code of codes) {
      const key = portalErrorKey(code);
      if (isSharedPortalError(key)) expect(en.portal.errors).toHaveProperty(key);
      else {
        expect(en.delivery.actions.error).toHaveProperty(key);
        expect(en.delivery.payments.error).toHaveProperty(key);
        expect(en.delivery.comments.error).toHaveProperty(key);
      }
    }
  });
});
