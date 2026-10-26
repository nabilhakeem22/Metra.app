import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { hashShareToken } from '@/lib/share/token';
import { clientCodeHash, issueClientCodeByToken, issueResultOf, newClientCode } from './codes';

const OK = {
  status: 'ok',
  email: 'client@example.org',
  hint: 'c•••@e•••.org',
  resend_after_seconds: 60,
  platform_day_half: false,
  studio: { name_ar: 'ديوان', name_en: 'Diwan' },
  document: { prefix: 'PR', number: 7, year: 2026 },
};

describe('newClientCode', () => {
  it('is six digits and a uuid challenge, and its hash is sha256 of challengeId:code', () => {
    for (let index = 0; index < 50; index += 1) {
      const fresh = newClientCode();
      expect(fresh.code).toMatch(/^\d{6}$/);
      expect(fresh.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(fresh.codeHash).toBe(createHash('sha256').update(`${fresh.challengeId}:${fresh.code}`).digest('hex'));
      expect(clientCodeHash(fresh.challengeId, fresh.code)).toBe(fresh.codeHash);
    }
  });
});

describe('issueResultOf', () => {
  it('reads ok with the email facts, the document number formatted', () => {
    expect(issueResultOf(OK)).toEqual({
      status: 'ok',
      email: 'client@example.org',
      hint: 'c•••@e•••.org',
      resendAfterSeconds: 60,
      platformDayHalf: false,
      studio: { nameAr: 'ديوان', nameEn: 'Diwan' },
      documentNumber: 'PR-2026-0007',
    });
  });

  it('reads the refusals and too_many with its wait', () => {
    for (const status of ['no_channel', 'not_available', 'busy', 'invalid', 'expired']) expect(issueResultOf({ status })).toEqual({ status });
    expect(issueResultOf({ status: 'too_many', retry_after_seconds: 3600 })).toEqual({ status: 'too_many', retryAfterSeconds: 3600 });
  });

  it('throws on a shape it cannot read, naming the status and never the address', () => {
    for (const payload of [null, {}, { status: 'ok' }, { ...OK, document: { prefix: 'X', number: 1, year: 2026 } }, { status: 'too_many' }, { status: 'later' }]) {
      expect(() => issueResultOf(payload)).toThrow(/app_home_code_issue_by_token/);
    }
    try {
      issueResultOf({ ...OK, platform_day_half: 'yes' });
    } catch (error) {
      expect(String(error)).not.toContain('client@example.org');
    }
  });
});

describe('issueClientCodeByToken (AC14: only the hash reaches the database)', () => {
  it('runs the issue function once as a write, passing the challenge and the hash, never the code', async () => {
    sdf.readSdfJson.mockResolvedValue(OK);
    const code = newClientCode();
    await issueClientCodeByToken(' tok ', { code, purpose: 'claim_request', target: 'req', ip: '1.2.3.4', userAgent: 'ua' });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    const [query, options] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }, unknown];
    expect(options).toEqual({ write: true });
    const params = query.queryChunks.filter((chunk) => typeof chunk === 'string' || typeof chunk === 'number');
    expect(params).toEqual([hashShareToken('tok'), code.challengeId, 'claim_request', 'req', code.codeHash, '1.2.3.4', 'ua']);
    expect(JSON.stringify(query.queryChunks)).not.toContain(`"${code.code}"`);
  });

  it('a blank token is invalid with no round trip', async () => {
    sdf.readSdfJson.mockClear();
    expect(await issueClientCodeByToken('  ', { code: newClientCode(), purpose: 'claim_request', target: 'req', ip: null, userAgent: null })).toEqual({
      status: 'invalid',
    });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});
