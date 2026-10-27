import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { hashShareToken } from '@/lib/share/token';
import { claimDesignPaymentWithCodeByToken, claimRequestWithCodeByToken } from './code-acts';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const PROOF = { code: '042917', ip: '9.9.9.9', userAgent: 'probe/1' };
const hashOf = (purpose: string, target: string, code: string) => createHash('sha256').update(`${purpose}:${target}:${code}`).digest('hex');

/** The bound values of the statement the act ran (`call`: which round trip). */
function sentParams(call = 0): unknown[] {
  const [query] = sdf.readSdfJson.mock.calls[call] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => chunk === null || typeof chunk !== 'object');
}

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfJson.mockResolvedValue({ code: 'ok' });
});

describe('claimRequestWithCodeByToken', () => {
  it('runs ONE write with the token hash and the code hash bound to the request, never the code nor a code id (AC14, F1)', async () => {
    expect(await claimRequestWithCodeByToken(' tok ', { ...PROOF, requestId: REQUEST })).toEqual({ ok: true, already: false });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(sdf.readSdfJson.mock.calls[0][1]).toEqual({ write: true });
    expect(sentParams()).toEqual([hashShareToken('tok'), REQUEST, hashOf('claim_request', REQUEST, '042917'), null, null, '9.9.9.9', 'probe/1']);
    expect(JSON.stringify(sentParams())).not.toContain('042917');
  });

  it('folds Arabic-Indic digits and keys an upper-case request id lower case, as the code was made', async () => {
    await claimRequestWithCodeByToken('tok', { ...PROOF, code: '٠٤٢٩١٧', requestId: REQUEST.toUpperCase() });
    expect(sentParams()[1]).toBe(REQUEST);
    expect(sentParams()[2]).toBe(hashOf('claim_request', REQUEST, '042917'));
  });

  it('a lock wait that gave up (55P03) or a deadlock (40P01) is busy, the code unused (R4)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const code of ['55P03', '40P01']) {
      sdf.readSdfJson.mockRejectedValueOnce(Object.assign(new Error('lock'), { code }));
      expect(await claimRequestWithCodeByToken('tok', { ...PROOF, requestId: REQUEST })).toEqual({ ok: false, error: 'busy' });
    }
  });

  it("the wrapper's own busy writes ONE line naming the act, never the token or the code (H6.2 R-L6)", async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sdf.readSdfJson.mockResolvedValueOnce({ code: 'busy' });
    expect(await claimRequestWithCodeByToken('tok', { ...PROOF, requestId: REQUEST })).toEqual({ ok: false, error: 'busy' });
    expect(logged.mock.calls).toEqual([['client code act refused:', { purpose: 'claim_request', refusal: 'busy' }]]);
    logged.mockRestore();
  });

  it('refuses before any round trip: a blank token, a request that is not a uuid, a code that is not six digits', async () => {
    expect(await claimRequestWithCodeByToken('  ', { ...PROOF, requestId: REQUEST })).toEqual({ ok: false, error: 'token_invalid' });
    expect(await claimRequestWithCodeByToken('tok', { ...PROOF, requestId: 'r1' })).toEqual({ ok: false, error: 'wrong_target' });
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
    expect(sentParams()).toEqual([hashShareToken('tok'), 'deposit', hashOf('claim_design_payment', 'deposit', '042917'), null, null, '9.9.9.9', 'probe/1']);
  });

  it('a milestone kind that is not text names no code: code_unknown, no round trip', async () => {
    expect(await claimDesignPaymentWithCodeByToken('tok', { ...PROOF, milestoneKind: 7 })).toEqual({ ok: false, error: 'code_unknown' });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});
