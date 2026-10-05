import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { portalErrorKey } from './portal-error-key';

describe('portalErrorKey', () => {
  it('keeps the four codes the portal has copy for', () => {
    for (const code of ['token_invalid', 'token_expired', 'not_active', 'wrong_state']) {
      expect(portalErrorKey(code)).toBe(code);
    }
  });

  it('folds codes the portal has no copy for, and absent codes, into generic', () => {
    expect(portalErrorKey('already_responded')).toBe('generic');
    expect(portalErrorKey('contract_inactive')).toBe('generic');
    expect(portalErrorKey(undefined)).toBe('generic');
    expect(portalErrorKey(null)).toBe('generic');
  });

  it('only ever answers a key both delivery error catalogs define', () => {
    const codes = ['token_invalid', 'token_expired', 'not_active', 'wrong_state', 'x', undefined];
    for (const code of codes) {
      const key = portalErrorKey(code);
      expect(en.delivery.actions.error).toHaveProperty(key);
      expect(en.delivery.payments.error).toHaveProperty(key);
    }
  });
});
