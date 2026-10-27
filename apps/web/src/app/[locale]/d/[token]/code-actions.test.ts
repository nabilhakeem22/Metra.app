import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// H5: the client's code request. ONE token function; the code goes to the
// address the database names, through a FAKE sender (Resend is never reached
// from a test), with a link that opens the act on its code box (F1); the
// browser hears only where it went (the masked hint), never the address, the
// studio's words, the code or its row (AC14). too_many (with its limit, R6)
// and busy are logged, and so is the platform's half day (the alarm, once:
// R2). A send that fails is `send_failed` with the 60 s spacing (F2), the
// provider's status in its log line (R6), and the code marked unsent so it
// spends no day (R1).

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
const brake = vi.hoisted(() => ({ portalActAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/share/portal-rate-limit', () => brake);
const origin = vi.hoisted(() => ({ resolveRequestOrigin: vi.fn(async (): Promise<string | null> => 'https://metra.example') }));
vi.mock('@/lib/http/request-origin', () => origin);
vi.mock('@/lib/engagements/portal-url', () => ({ requestLocaleOrDefault: async () => 'ar-EG' }));
const db = vi.hoisted(() => ({ issueClientCodeByToken: vi.fn(), markClientCodeUnsentByToken: vi.fn() }));
vi.mock('@/lib/client-home/codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client-home/codes')>()),
  issueClientCodeByToken: db.issueClientCodeByToken,
  markClientCodeUnsentByToken: db.markClientCodeUnsentByToken,
}));
const sender = vi.hoisted(() => ({ sendClientCodeEmail: vi.fn() }));
vi.mock('@/lib/email/client-code', () => sender);

import { hashShareToken } from '@/lib/share/token';
import { requestClientCode } from './code-actions';

const TOKEN = 'portal-link-token';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const ROW = '33333333-3333-4333-8333-333333333333';
const ISSUED = {
  status: 'ok',
  challengeId: ROW,
  email: 'client@example.org',
  hint: 'c•••@e•••.org',
  resendAfterSeconds: 60,
  platformDayHalfCrossed: false,
  studio: { nameAr: 'ديوان', nameEn: 'Diwan' },
  documentNumber: 'PR-2026-0007',
};

let logs: string;
beforeEach(() => {
  vi.restoreAllMocks();
  logs = '';
  const capture = (...args: unknown[]) => {
    logs += JSON.stringify(args);
  };
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  brake.portalActAllowed.mockResolvedValue(true);
  origin.resolveRequestOrigin.mockResolvedValue('https://metra.example');
  db.issueClientCodeByToken.mockReset();
  db.issueClientCodeByToken.mockResolvedValue(ISSUED);
  db.markClientCodeUnsentByToken.mockReset();
  db.markClientCodeUnsentByToken.mockResolvedValue('ok');
  sender.sendClientCodeEmail.mockReset();
  sender.sendClientCodeEmail.mockResolvedValue({ sent: true });
});

/** The code the fake sender was handed. */
const sentCode = () => (sender.sendClientCodeEmail.mock.calls[0][0] as { code: string }).code;

describe('a code that is made and sent', () => {
  it('asks the database once with the hash, emails the code with a link to the act, and tells the browser only the hint', async () => {
    const answer = await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST.toUpperCase() });
    expect(db.issueClientCodeByToken).toHaveBeenCalledTimes(1);
    const [rawToken, input] = db.issueClientCodeByToken.mock.calls[0] as [string, { codeHash: string; target: string }];
    expect(rawToken).toBe(TOKEN);
    expect(input).toMatchObject({ purpose: 'claim_request', target: REQUEST, ip: '9.9.9.9', userAgent: 'probe/1' });
    expect(sender.sendClientCodeEmail).toHaveBeenCalledWith({
      to: 'client@example.org',
      code: sentCode(),
      purpose: 'claim_request',
      documentNumber: 'PR-2026-0007',
      studioName: 'ديوان',
      homeUrl: `https://metra.example/ar-EG/d/${TOKEN}?tab=execution&focus=request:${REQUEST}`,
      locale: 'ar-EG',
    });
    expect(sentCode()).toMatch(/^\d{6}$/);
    expect(input.codeHash).toBe(createHash('sha256').update(`claim_request:${REQUEST}:${sentCode()}`).digest('hex'));
    expect(answer).toEqual({ ok: true, hint: 'c•••@e•••.org', resendAfterSeconds: 60 });
    const said = JSON.stringify(answer);
    for (const secret of ['client@example.org', sentCode(), 'ديوان', 'PR-2026-0007', input.codeHash, ROW]) expect(said).not.toContain(secret);
    expect(db.markClientCodeUnsentByToken).not.toHaveBeenCalled();
    expect(logs).toBe('');
  });

  it('links a design instalment\'s email to its claim on the design page', async () => {
    db.issueClientCodeByToken.mockResolvedValue({ ...ISSUED, documentNumber: 'DE-2026-0012' });
    await requestClientCode(TOKEN, { purpose: 'claim_design_payment', target: 'deposit' });
    expect(sender.sendClientCodeEmail.mock.calls[0][0]).toMatchObject({
      purpose: 'claim_design_payment',
      documentNumber: 'DE-2026-0012',
      homeUrl: `https://metra.example/ar-EG/d/${TOKEN}?tab=design&focus=instalment:deposit`,
    });
  });

  it('raises the alarm when the code crossed half the platform day, and only then (R2)', async () => {
    expect((await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).ok).toBe(true);
    expect(logs).not.toContain('ALERT');
    db.issueClientCodeByToken.mockResolvedValue({ ...ISSUED, platformDayHalfCrossed: true });
    expect((await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).ok).toBe(true);
    expect(logs).toContain('ALERT client codes: the platform day has used half its cap');
    expect(logs).not.toContain('client@example.org');
  });
});

describe('a send that failed (R1, R6, F2)', () => {
  it('is send_failed with the 60 s spacing; the code is marked unsent; the log names the provider status, never the code or the address', async () => {
    sender.sendClientCodeEmail.mockResolvedValue({ sent: false, transient: true, refusal: { statusCode: 429, name: 'rate_limit_exceeded' } });
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({
      ok: false,
      error: 'send_failed',
      resendAfterSeconds: 60,
    });
    expect(db.markClientCodeUnsentByToken).toHaveBeenCalledWith(TOKEN, ROW);
    expect(logs).toContain('client code email not sent');
    expect(logs).toContain('"transient":true,"statusCode":429,"name":"rate_limit_exceeded"');
    expect(logs).not.toContain(sentCode());
    expect(logs).not.toContain('client@example.org');
  });

  it('a mark that did not land is logged and never thrown: the client still hears send_failed', async () => {
    sender.sendClientCodeEmail.mockResolvedValue({ sent: false, transient: true });
    db.markClientCodeUnsentByToken.mockResolvedValueOnce('busy');
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toMatchObject({ ok: false, error: 'send_failed' });
    expect(logs).toContain('client code unsent mark failed:');
    expect(logs).toContain('"outcome":"busy"');
    db.markClientCodeUnsentByToken.mockRejectedValueOnce(new Error('connection'));
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toMatchObject({ ok: false, error: 'send_failed' });
    expect(logs).toContain('"outcome":"failed"');
  });
});

describe('refusals', () => {
  it.each([
    [{ status: 'no_channel' }, { ok: false, error: 'no_channel' }],
    [{ status: 'not_available' }, { ok: false, error: 'not_available' }],
    [{ status: 'invalid' }, { ok: false, error: 'token_invalid' }],
    [{ status: 'expired' }, { ok: false, error: 'token_expired' }],
  ])('%j answers %j and sends nothing', async (issued, answer) => {
    db.issueClientCodeByToken.mockResolvedValue(issued);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual(answer);
    expect(sender.sendClientCodeEmail).not.toHaveBeenCalled();
  });

  it('too_many carries the exact wait and its limit, and its log line names the limit (R6); busy is logged', async () => {
    db.issueClientCodeByToken.mockResolvedValue({ status: 'too_many', retryAfterSeconds: 3540, limit: 'studio_day' });
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({
      ok: false,
      error: 'too_many',
      retryAfterSeconds: 3540,
      limit: 'studio_day',
    });
    expect(logs).toContain('client code request refused:');
    expect(logs).toContain('"refusal":"too_many","limit":"studio_day","retryAfterSeconds":3540');
    db.issueClientCodeByToken.mockResolvedValue({ status: 'busy' });
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'busy' });
    expect(logs).toContain('"refusal":"busy"');
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(hashShareToken(TOKEN));
    expect(sender.sendClientCodeEmail).not.toHaveBeenCalled();
  });

  it('an act this build takes no code for, or a target that names none, is not_available with no round trip', async () => {
    for (const input of [
      { purpose: 'sign_contract', target: REQUEST },
      { purpose: 'claim_request', target: 'not-a-uuid' },
      { purpose: 'claim_design_payment', target: '' },
      { purpose: 'claim_design_payment', target: 'retainer' },
      { purpose: 'claim_design_payment', target: 'x'.repeat(65) },
      null,
    ]) {
      expect(await requestClientCode(TOKEN, input as never)).toEqual({ ok: false, error: 'not_available' });
    }
    expect(db.issueClientCodeByToken).not.toHaveBeenCalled();
    expect(brake.portalActAllowed).not.toHaveBeenCalled();
  });

  it('past the link\'s brake the limit is the link\'s minute; with no public origin nothing is made, so no spacing', async () => {
    brake.portalActAllowed.mockResolvedValueOnce(false);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({
      ok: false,
      error: 'too_many',
      retryAfterSeconds: 60,
      limit: 'link_minute',
    });
    origin.resolveRequestOrigin.mockResolvedValueOnce(null);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({
      ok: false,
      error: 'send_failed',
      resendAfterSeconds: null,
    });
    expect(db.issueClientCodeByToken).not.toHaveBeenCalled();
  });

  it('a failure underneath answers uncertain, its one log line carrying neither the token nor the code', async () => {
    db.issueClientCodeByToken.mockRejectedValue(
      Object.assign(new Error('Failed query: params: SECRET-HASH'), { cause: Object.assign(new Error('connection'), { code: '08006' }) }),
    );
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'uncertain' });
    expect(logs).toContain('requestClientCode');
    expect(logs).not.toContain('SECRET-HASH');
    expect(logs).not.toContain(TOKEN);
  });
});
