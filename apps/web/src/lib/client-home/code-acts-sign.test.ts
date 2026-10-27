import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.2: signing the contract in the home with a code (./code-acts.ts), the
// server's half: what is sent, and what is answered without sending the act.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { hashShareToken } from '@/lib/share/token';
import { signContractWithCodeByToken } from './code-acts';

const CONTRACT = '22222222-2222-4222-8222-222222222222';
const OTHER = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = { id: CONTRACT, status: 'issued', total: '1140.0000', sections: [] } as unknown as PublicContract;
const SIGN = { code: '042917', ip: '9.9.9.9', userAgent: 'probe/1', contractId: CONTRACT, name: ' ‮هشام  عادل ' };
const hashOf = (purpose: string, target: string, code: string) => createHash('sha256').update(`${purpose}:${target}:${code}`).digest('hex');

/** The bound values of the statement of round trip `call`. */
function sentParams(call: number): unknown[] {
  const [query] = sdf.readSdfJson.mock.calls[call] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => chunk === null || typeof chunk !== 'object');
}

/** Only the snapshot read went out, never the act. */
function expectActNotSent(reads: number) {
  expect(sdf.readSdfJson).toHaveBeenCalledTimes(reads);
  expect(JSON.stringify(sdf.readSdfJson.mock.calls)).not.toContain('app_home_contract_ack_by_token');
}

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfJson.mockResolvedValueOnce(SNAPSHOT).mockResolvedValueOnce({ code: 'ok' });
});

afterEach(() => vi.restoreAllMocks());

describe('signContractWithCodeByToken', () => {
  it('reads the snapshot, then runs ONE write with exactly 7 values: the server hash of /c, the code hash bound to the contract, the cleaned name', async () => {
    expect(await signContractWithCodeByToken(' tok ', { ...SIGN, contractId: CONTRACT.toUpperCase() })).toEqual({ ok: true, already: false });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('app_home_contract_by_token');
    expect(sdf.readSdfJson.mock.calls[1][1]).toEqual({ write: true });
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[1][0])).toContain('select public.app_home_contract_ack_by_token(');
    const sent = [hashShareToken('tok'), CONTRACT, hashOf('sign_contract', CONTRACT, '042917'), 'هشام عادل', '9.9.9.9', 'probe/1', contractPayloadHash(SNAPSHOT)];
    expect(sentParams(1)).toEqual(sent);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls)).not.toContain('042917');
  });

  it('passes the act answers through: already, a wrong code with its tries, signing_closed', async () => {
    sdf.readSdfJson.mockReset();
    for (const [payload, answer] of [
      [{ code: 'already' }, { ok: true, already: true }],
      [{ code: 'code_wrong', attempts_left: 3 }, { ok: false, error: 'code_wrong', attemptsLeft: 3 }],
      [{ code: 'signing_closed' }, { ok: false, error: 'signing_closed' }],
    ]) {
      sdf.readSdfJson.mockResolvedValueOnce(SNAPSHOT).mockResolvedValueOnce(payload);
      expect(await signContractWithCodeByToken('tok', SIGN)).toEqual(answer);
    }
  });

  it('refuses before any round trip: an id that is not a uuid, no name, a blank token, a code that is not six digits', async () => {
    for (const contractId of ['c1', '', null, 7]) {
      expect(await signContractWithCodeByToken('tok', { ...SIGN, contractId })).toEqual({ ok: false, error: 'wrong_target' });
    }
    for (const name of ['', '   ', '‏\u0000', 'ㅤ⁠', 'x'.repeat(961), null, 42]) {
      expect(await signContractWithCodeByToken('tok', { ...SIGN, name })).toEqual({ ok: false, error: 'name_required' });
    }
    expect(await signContractWithCodeByToken('  ', SIGN)).toEqual({ ok: false, error: 'token_invalid' });
    for (const code of ['12345', '1234567', 'abcdef', 123456, null]) {
      expect(await signContractWithCodeByToken('tok', { ...SIGN, code })).toEqual({ ok: false, error: 'code_wrong' });
    }
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a home whose contract is now another one, or none (a dead link too), is contract_inactive: one read, the act never sent', async () => {
    sdf.readSdfJson.mockReset();
    sdf.readSdfJson.mockResolvedValueOnce({ ...SNAPSHOT, id: OTHER });
    expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: false, error: 'contract_inactive' });
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: false, error: 'contract_inactive' });
    expectActNotSent(2);
  });

  it('a contract the snapshot shows signed already is `already`: one read, the act never sent, the code untouched (F3)', async () => {
    sdf.readSdfJson.mockReset();
    sdf.readSdfJson.mockResolvedValueOnce({ ...SNAPSHOT, status: 'signed' });
    expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: true, already: true });
    expectActNotSent(1);
  });

  it('ANY failure of the snapshot read is busy, the act never sent, one redacted line (R-L1)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sdf.readSdfJson.mockReset();
    const failures = [Object.assign(new Error('lock'), { code: '55P03' }), Object.assign(new Error('x'), { name: 'DbDeadlineError' }), new Error('write CONNECTION_CLOSED')];
    for (const failure of failures) {
      sdf.readSdfJson.mockRejectedValueOnce(failure);
      expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: false, error: 'busy' });
    }
    expectActNotSent(3);
    expect(logged).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(hashShareToken('tok'));
  });

  it('a lock wait that gave up (55P03) or a deadlock (40P01) on the act is busy, the code unused (R4)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sdf.readSdfJson.mockReset();
    for (const code of ['55P03', '40P01']) {
      sdf.readSdfJson.mockResolvedValueOnce(SNAPSHOT).mockRejectedValueOnce(Object.assign(new Error('lock'), { code }));
      expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: false, error: 'busy' });
    }
  });

  it("the wrapper's own busy writes ONE line naming the act, never the token, the code or the name (R-L6)", async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sdf.readSdfJson.mockReset();
    sdf.readSdfJson.mockResolvedValueOnce(SNAPSHOT).mockResolvedValueOnce({ code: 'busy' });
    expect(await signContractWithCodeByToken('tok', SIGN)).toEqual({ ok: false, error: 'busy' });
    expect(logged.mock.calls).toEqual([['client code act refused:', { purpose: 'sign_contract', refusal: 'busy' }]]);
  });
});
