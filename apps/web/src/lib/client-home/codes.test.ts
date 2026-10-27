import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn(), readSdfCode: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
  readSdfCode: sdf.readSdfCode,
}));

import { hashShareToken } from '@/lib/share/token';
import { clientCodeHash, issueClientCodeByToken, issueResultOf, markClientCodeUnsentByToken, newClientCode } from './codes';

const ROW = '33333333-3333-4333-8333-333333333333';
const OK = {
  status: 'ok',
  challenge_id: ROW,
  email: 'client@example.org',
  hint: 'c•••@e•••.org',
  resend_after_seconds: 60,
  platform_day_half_crossed: false,
  studio: { name_ar: 'ديوان', name_en: 'Diwan' },
  document: { prefix: 'PR', number: 7, year: 2026 },
};

/** A Postgres error as the driver throws it. */
const pgError = (code: string) => Object.assign(new Error('lock'), { code });

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfCode.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('newClientCode', () => {
  it('is six digits, and its hash is sha256 of purpose:target:code (the act it is for, no code id: H5 F1)', () => {
    for (let index = 0; index < 50; index += 1) {
      const fresh = newClientCode('claim_request', 'req');
      expect(fresh.code).toMatch(/^\d{6}$/);
      expect(fresh.codeHash).toBe(createHash('sha256').update(`claim_request:req:${fresh.code}`).digest('hex'));
      expect(clientCodeHash('claim_request', 'req', fresh.code)).toBe(fresh.codeHash);
    }
    expect(clientCodeHash('claim_request', 'a', '123456')).not.toBe(clientCodeHash('claim_design_payment', 'a', '123456'));
    expect(clientCodeHash('claim_request', 'a', '123456')).not.toBe(clientCodeHash('claim_request', 'b', '123456'));
  });
});

describe('issueResultOf', () => {
  it('reads ok with the code\'s row and the email facts, the document number formatted', () => {
    expect(issueResultOf(OK)).toEqual({
      status: 'ok',
      challengeId: ROW,
      email: 'client@example.org',
      hint: 'c•••@e•••.org',
      resendAfterSeconds: 60,
      platformDayHalfCrossed: false,
      studio: { nameAr: 'ديوان', nameEn: 'Diwan' },
      documentNumber: 'PR-2026-0007',
    });
  });

  it('reads the refusals, and too_many with its wait and the limit it names (R6)', () => {
    for (const status of ['no_channel', 'not_available', 'busy', 'invalid', 'expired']) expect(issueResultOf({ status })).toEqual({ status });
    for (const limit of ['target_spacing', 'target_hour', 'target_tries', 'delivery_day', 'studio_day', 'platform_day']) {
      expect(issueResultOf({ status: 'too_many', retry_after_seconds: 3600, limit })).toEqual({ status: 'too_many', retryAfterSeconds: 3600, limit });
    }
  });

  it('throws on a shape it cannot read, naming the status and never the address', () => {
    for (const payload of [
      null,
      {},
      { status: 'ok' },
      { ...OK, document: { prefix: 'X', number: 1, year: 2026 } },
      { ...OK, challenge_id: 'not-a-row' },
      { status: 'too_many' },
      { status: 'too_many', retry_after_seconds: 60 },
      { status: 'too_many', retry_after_seconds: 60, limit: 'link_minute' },
      { status: 'later' },
    ]) {
      expect(() => issueResultOf(payload)).toThrow(/app_home_code_issue_by_token/);
    }
    try {
      issueResultOf({ ...OK, platform_day_half_crossed: 'yes' });
    } catch (error) {
      expect(String(error)).not.toContain('client@example.org');
    }
  });
});

describe('issueClientCodeByToken (AC14: only the hash reaches the database)', () => {
  it('runs the issue function once as a write, passing the act and the hash, never the code', async () => {
    sdf.readSdfJson.mockResolvedValue(OK);
    const code = newClientCode('claim_request', 'req');
    await issueClientCodeByToken(' tok ', { codeHash: code.codeHash, purpose: 'claim_request', target: 'req', ip: '1.2.3.4', userAgent: 'ua' });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    const [query, options] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }, unknown];
    expect(options).toEqual({ write: true });
    const params = query.queryChunks.filter((chunk) => typeof chunk === 'string' || typeof chunk === 'number');
    expect(params).toEqual([hashShareToken('tok'), 'claim_request', 'req', code.codeHash, '1.2.3.4', 'ua']);
    expect(JSON.stringify(query.queryChunks)).not.toContain(`"${code.code}"`);
  });

  it('a blank token is invalid with no round trip', async () => {
    expect(
      await issueClientCodeByToken('  ', { codeHash: 'a'.repeat(64), purpose: 'claim_request', target: 'req', ip: null, userAgent: null }),
    ).toEqual({ status: 'invalid' });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a lock wait that gave up (55P03) or a deadlock (40P01) is busy: the statement wrote nothing (R4)', async () => {
    for (const code of ['55P03', '40P01']) {
      sdf.readSdfJson.mockRejectedValueOnce(pgError(code));
      expect(await issueClientCodeByToken('tok', { codeHash: 'a'.repeat(64), purpose: 'claim_request', target: 'req', ip: null, userAgent: null })).toEqual({
        status: 'busy',
      });
    }
    sdf.readSdfJson.mockRejectedValueOnce(pgError('57014'));
    await expect(
      issueClientCodeByToken('tok', { codeHash: 'a'.repeat(64), purpose: 'claim_request', target: 'req', ip: null, userAgent: null }),
    ).rejects.toThrow();
  });
});

describe('markClientCodeUnsentByToken (R1)', () => {
  it('marks the code by the link\'s hash and the row the database named; any answer but ok or busy is gone', async () => {
    sdf.readSdfCode.mockResolvedValueOnce('ok');
    expect(await markClientCodeUnsentByToken(' tok ', ROW)).toBe('ok');
    const [query, options] = sdf.readSdfCode.mock.calls[0] as [{ queryChunks: unknown[] }, unknown];
    expect(options).toEqual({ write: true });
    expect(query.queryChunks.filter((chunk) => typeof chunk === 'string')).toEqual([hashShareToken('tok'), ROW]);
    sdf.readSdfCode.mockResolvedValueOnce('busy');
    expect(await markClientCodeUnsentByToken('tok', ROW)).toBe('busy');
    sdf.readSdfCode.mockResolvedValueOnce(undefined);
    expect(await markClientCodeUnsentByToken('tok', ROW)).toBe('gone');
    expect(await markClientCodeUnsentByToken('  ', ROW)).toBe('gone');
    expect(sdf.readSdfCode).toHaveBeenCalledTimes(3);
  });
});
