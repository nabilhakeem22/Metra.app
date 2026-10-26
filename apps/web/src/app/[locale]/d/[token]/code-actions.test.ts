import { beforeEach, describe, expect, it, vi } from 'vitest';

// H5: the client's code request. ONE token function; the code goes to the
// address the database names, through a FAKE sender (Resend is never reached
// from a test); the browser hears only where it went (the masked hint), never
// the address, the studio's words or the code (AC14). too_many and busy are
// logged, and so is the platform's half day (the alarm). A send that fails is
// `send_failed`, honestly.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
const brake = vi.hoisted(() => ({ portalActAllowed: vi.fn(async () => true) }));
vi.mock('@/lib/share/portal-rate-limit', () => brake);
const origin = vi.hoisted(() => ({ resolveRequestOrigin: vi.fn(async (): Promise<string | null> => 'https://metra.example') }));
vi.mock('@/lib/http/request-origin', () => origin);
vi.mock('@/lib/engagements/portal-url', () => ({ requestLocaleOrDefault: async () => 'ar-EG' }));
const issue = vi.hoisted(() => ({ issueClientCodeByToken: vi.fn() }));
vi.mock('@/lib/client-home/codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client-home/codes')>()),
  issueClientCodeByToken: issue.issueClientCodeByToken,
}));
const sender = vi.hoisted(() => ({ sendClientCodeEmail: vi.fn() }));
vi.mock('@/lib/email/client-code', () => sender);

import { hashShareToken } from '@/lib/share/token';
import { requestClientCode } from './code-actions';

const TOKEN = 'portal-link-token';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const ISSUED = {
  status: 'ok',
  email: 'client@example.org',
  hint: 'c•••@e•••.org',
  resendAfterSeconds: 60,
  platformDayHalf: false,
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
  issue.issueClientCodeByToken.mockReset();
  issue.issueClientCodeByToken.mockResolvedValue(ISSUED);
  sender.sendClientCodeEmail.mockReset();
  sender.sendClientCodeEmail.mockResolvedValue({ sent: true });
});

/** The code the fake sender was handed. */
const sentCode = () => (sender.sendClientCodeEmail.mock.calls[0][0] as { code: string }).code;

describe('a code that is made and sent', () => {
  it('asks the database once with the hash, emails the code to the address it named, and tells the browser only the hint', async () => {
    const answer = await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST.toUpperCase() });
    expect(issue.issueClientCodeByToken).toHaveBeenCalledTimes(1);
    const [rawToken, input] = issue.issueClientCodeByToken.mock.calls[0] as [string, { code: { challengeId: string; codeHash: string }; target: string }];
    expect(rawToken).toBe(TOKEN);
    expect(input).toMatchObject({ purpose: 'claim_request', target: REQUEST, ip: '9.9.9.9', userAgent: 'probe/1' });
    expect(sender.sendClientCodeEmail).toHaveBeenCalledWith({
      to: 'client@example.org',
      code: sentCode(),
      purpose: 'claim_request',
      documentNumber: 'PR-2026-0007',
      studioName: 'ديوان',
      homeUrl: `https://metra.example/ar-EG/d/${TOKEN}?tab=execution`,
      locale: 'ar-EG',
    });
    expect(sentCode()).toMatch(/^\d{6}$/);
    expect(answer).toEqual({ ok: true, challengeId: input.code.challengeId, hint: 'c•••@e•••.org', resendAfterSeconds: 60 });
    const said = JSON.stringify(answer);
    for (const secret of ['client@example.org', sentCode(), 'ديوان', 'PR-2026-0007', input.code.codeHash]) expect(said).not.toContain(secret);
    expect(logs).toBe('');
  });

  it('links a design instalment\'s email to the design page', async () => {
    issue.issueClientCodeByToken.mockResolvedValue({ ...ISSUED, documentNumber: 'DE-2026-0012' });
    await requestClientCode(TOKEN, { purpose: 'claim_design_payment', target: 'deposit' });
    expect(sender.sendClientCodeEmail.mock.calls[0][0]).toMatchObject({
      purpose: 'claim_design_payment',
      documentNumber: 'DE-2026-0012',
      homeUrl: `https://metra.example/ar-EG/d/${TOKEN}`,
    });
  });

  it('raises the alarm when the code took the platform day to half its cap', async () => {
    issue.issueClientCodeByToken.mockResolvedValue({ ...ISSUED, platformDayHalf: true });
    expect((await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).ok).toBe(true);
    expect(logs).toContain('ALERT client codes: the platform day has used half its cap');
    expect(logs).not.toContain(sentCode());
    expect(logs).not.toContain('client@example.org');
  });

  it('a send that failed is send_failed, logged without the code or the address', async () => {
    sender.sendClientCodeEmail.mockResolvedValue({ sent: false, transient: false });
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'send_failed' });
    expect(logs).toContain('client code email not sent');
    expect(logs).not.toContain(sentCode());
    expect(logs).not.toContain('client@example.org');
  });
});

describe('refusals', () => {
  it.each([
    [{ status: 'no_channel' }, { ok: false, error: 'no_channel' }],
    [{ status: 'not_available' }, { ok: false, error: 'not_available' }],
    [{ status: 'invalid' }, { ok: false, error: 'token_invalid' }],
    [{ status: 'expired' }, { ok: false, error: 'token_expired' }],
  ])('%j answers %j and sends nothing', async (issued, answer) => {
    issue.issueClientCodeByToken.mockResolvedValue(issued);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual(answer);
    expect(sender.sendClientCodeEmail).not.toHaveBeenCalled();
  });

  it('too_many carries the exact wait and is logged; busy is logged', async () => {
    issue.issueClientCodeByToken.mockResolvedValue({ status: 'too_many', retryAfterSeconds: 3540 });
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'too_many', retryAfterSeconds: 3540 });
    expect(logs).toContain('client code request refused:');
    expect(logs).toContain('"refusal":"too_many","retryAfterSeconds":3540');
    issue.issueClientCodeByToken.mockResolvedValue({ status: 'busy' });
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
      { purpose: 'claim_design_payment', target: 'x'.repeat(65) },
      null,
    ]) {
      expect(await requestClientCode(TOKEN, input as never)).toEqual({ ok: false, error: 'not_available' });
    }
    expect(issue.issueClientCodeByToken).not.toHaveBeenCalled();
    expect(brake.portalActAllowed).not.toHaveBeenCalled();
  });

  it('past the link\'s brake, or with no public origin for the email\'s link, nothing is written', async () => {
    brake.portalActAllowed.mockResolvedValueOnce(false);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'too_many', retryAfterSeconds: 60 });
    origin.resolveRequestOrigin.mockResolvedValueOnce(null);
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'send_failed' });
    expect(issue.issueClientCodeByToken).not.toHaveBeenCalled();
  });

  it('a failure underneath answers uncertain, its one log line carrying neither the token nor the code', async () => {
    issue.issueClientCodeByToken.mockRejectedValue(
      Object.assign(new Error('Failed query: params: SECRET-HASH'), { cause: Object.assign(new Error('lock timeout'), { code: '55P03' }) }),
    );
    expect(await requestClientCode(TOKEN, { purpose: 'claim_request', target: REQUEST })).toEqual({ ok: false, error: 'uncertain' });
    expect(logs).toContain('requestClientCode');
    expect(logs).not.toContain('SECRET-HASH');
    expect(logs).not.toContain(TOKEN);
  });
});
