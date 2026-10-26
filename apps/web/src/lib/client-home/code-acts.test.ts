import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { hashShareToken } from '@/lib/share/token';
import { claimDesignPaymentWithCodeByToken, claimRequestWithCodeByToken, codeAnswerOf } from './code-acts';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const CHALLENGE = '22222222-2222-4222-8222-222222222222';
const PROOF = { challengeId: CHALLENGE, code: '042917', ip: '9.9.9.9', userAgent: 'probe/1' };
const hashOf = (challengeId: string, code: string) => createHash('sha256').update(`${challengeId}:${code}`).digest('hex');

/** The bound values of the one statement the act ran. */
function sentParams(): unknown[] {
  const [query] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => chunk === null || typeof chunk !== 'object');
}

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfJson.mockResolvedValue({ code: 'ok' });
});

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

  it('reads invalid, nothing and a code nobody sent as a dead link, never as success', () => {
    for (const payload of [{ code: 'invalid' }, null, {}, { code: 'expired' }, { code: 'code_wrong' }, { code: 'OK' }]) {
      expect(codeAnswerOf(payload)).toEqual({ ok: false, error: 'token_invalid' });
    }
  });
});

describe('claimRequestWithCodeByToken', () => {
  it('runs ONE write with the token hash and the code hash, never the code (AC14)', async () => {
    expect(await claimRequestWithCodeByToken(' tok ', { ...PROOF, requestId: REQUEST })).toEqual({ ok: true, already: false });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(sdf.readSdfJson.mock.calls[0][1]).toEqual({ write: true });
    expect(sentParams()).toEqual([hashShareToken('tok'), REQUEST, CHALLENGE, hashOf(CHALLENGE, '042917'), null, null, '9.9.9.9', 'probe/1']);
    expect(JSON.stringify(sentParams())).not.toContain('042917');
  });

  it('folds Arabic-Indic digits and hashes an upper-case challenge id as the app made it', async () => {
    await claimRequestWithCodeByToken('tok', { ...PROOF, challengeId: CHALLENGE.toUpperCase(), code: '٠٤٢٩١٧', requestId: REQUEST });
    expect(sentParams()[2]).toBe(CHALLENGE);
    expect(sentParams()[3]).toBe(hashOf(CHALLENGE, '042917'));
  });

  it('refuses before any round trip: a blank token, a request or challenge that is not a uuid, a code that is not six digits', async () => {
    expect(await claimRequestWithCodeByToken('  ', { ...PROOF, requestId: REQUEST })).toEqual({ ok: false, error: 'token_invalid' });
    expect(await claimRequestWithCodeByToken('tok', { ...PROOF, requestId: 'r1' })).toEqual({ ok: false, error: 'wrong_target' });
    expect(await claimRequestWithCodeByToken('tok', { ...PROOF, challengeId: 'c1', requestId: REQUEST })).toEqual({ ok: false, error: 'code_unknown' });
    for (const code of ['12345', '1234567', 'abcdef', 123456, null]) {
      expect(await claimRequestWithCodeByToken('tok', { ...PROOF, code, requestId: REQUEST })).toEqual({ ok: false, error: 'code_wrong' });
    }
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});

describe('claimDesignPaymentWithCodeByToken', () => {
  it('runs ONE write naming the milestone kind, with the code hash', async () => {
    sdf.readSdfJson.mockResolvedValue({ code: 'code_wrong', attempts_left: 0 });
    expect(await claimDesignPaymentWithCodeByToken('tok', { ...PROOF, milestoneKind: 'deposit' })).toEqual({
      ok: false,
      error: 'code_wrong',
      attemptsLeft: 0,
    });
    expect(sentParams()).toEqual([hashShareToken('tok'), 'deposit', CHALLENGE, hashOf(CHALLENGE, '042917'), null, null, '9.9.9.9', 'probe/1']);
  });

  it('a milestone kind that is not text names no code: code_unknown, no round trip', async () => {
    expect(await claimDesignPaymentWithCodeByToken('tok', { ...PROOF, milestoneKind: 7 })).toEqual({ ok: false, error: 'code_unknown' });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});
