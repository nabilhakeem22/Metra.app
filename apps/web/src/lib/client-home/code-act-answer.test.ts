import { describe, expect, it } from 'vitest';
import { codeAnswerOf } from './code-act-answer';

describe('codeAnswerOf: every answer of the act wrappers', () => {
  it('reads ok and already as done, the act IS done on already', () => {
    expect(codeAnswerOf({ code: 'ok' })).toEqual({ ok: true, already: false });
    expect(codeAnswerOf({ code: 'already' })).toEqual({ ok: true, already: true });
  });

  it('reads a wrong code with its tries left', () => {
    expect(codeAnswerOf({ code: 'code_wrong', attempts_left: 2 })).toEqual({ ok: false, error: 'code_wrong', attemptsLeft: 2 });
  });

  it.each([
    'code_unknown',
    'code_expired',
    'code_used',
    'code_locked',
    'wrong_target',
    'token_expired',
    'not_active',
    'wrong_state',
    'busy',
    'signing_closed',
    'link_expired',
    'contract_inactive',
  ])('passes %s through', (code) => {
    expect(codeAnswerOf({ code })).toEqual({ ok: false, error: code });
  });

  it('reads the claim ceiling as too_many with its wait (R5)', () => {
    expect(codeAnswerOf({ code: 'too_many', limit: 'claims_hour', retry_after_seconds: 2400 })).toEqual({
      ok: false,
      error: 'too_many',
      limit: 'claims_hour',
      retryAfterSeconds: 2400,
    });
  });

  it('reads invalid, nothing and a code nobody sent as a dead link, never as success', () => {
    for (const payload of [
      { code: 'invalid' },
      null,
      {},
      { code: 'expired' },
      { code: 'code_wrong' },
      { code: 'OK' },
      { code: 'too_many' },
      { code: 'too_many', limit: 'studio_day', retry_after_seconds: 60 },
    ]) {
      expect(codeAnswerOf(payload)).toEqual({ ok: false, error: 'token_invalid' });
    }
  });
});
