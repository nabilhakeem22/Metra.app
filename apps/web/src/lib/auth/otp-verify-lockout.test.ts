import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// verifyOtpCore and the sign-in pause (security batch 3, P2; AC28, AC32): which
// database calls one code check makes, and in which order around Supabase. The
// real core, lockout policy and failure mapping run; Supabase, the counter's
// database leaf and the post-login probe are doubles.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => false, cfEnv: () => ({}) }));
const supabase = vi.hoisted(() => ({ create: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: supabase.create }));
vi.mock('./post-login-path', () => ({ postLoginPathFor: async () => '/dashboard' }));
const leaf = vi.hoisted(() => ({ readSignInPauseSeconds: vi.fn(), recordWrongSignInCode: vi.fn() }));
vi.mock('./sign-in-failures-db', () => leaf);

const { verifyOtpCore } = await import('./otp');
const { signInIdentifierHash } = await import('./sign-in-lockout');

const ADDRESS = 'mona@firm.example';
const PHONE = '+201001234567';
const EMAIL_CHECK = { channel: 'email', identifier: ADDRESS, token: '123456' } as const;
const WRONG_CODE = { data: { user: null }, error: { code: 'otp_expired', status: 403 } };
const CODE_REFUSED = { ok: false, error: 'check_fields', fields: { token: { code: 'otp_verify_failed' } } };

beforeEach(() => {
  supabase.verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  supabase.create.mockReset().mockResolvedValue({ auth: { verifyOtp: supabase.verifyOtp } });
  leaf.readSignInPauseSeconds.mockReset().mockResolvedValue(null);
  leaf.recordWrongSignInCode.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('verifyOtpCore and the sign-in pause', () => {
  it('a right code makes exactly one counter call, the read before Supabase, and records nothing (AC32)', async () => {
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual({ ok: true, next: '/dashboard' });
    expect(leaf.readSignInPauseSeconds.mock.calls).toEqual([[signInIdentifierHash(ADDRESS)]]);
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
    expect(leaf.readSignInPauseSeconds.mock.invocationCallOrder[0]).toBeLessThan(supabase.verifyOtp.mock.invocationCallOrder[0]!);
  });

  it('a paused identifier is refused before Supabase is asked, and nothing is recorded (AC28)', async () => {
    leaf.readSignInPauseSeconds.mockResolvedValue(2400);
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual({ ok: false, error: 'otp_sign_in_paused', params: { minutes: 40, minutesText: '40' } });
    expect(supabase.create).not.toHaveBeenCalled();
    expect(supabase.verifyOtp).not.toHaveBeenCalled();
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
  });

  it('a wrong code makes two counter calls: the read, then Supabase, then one record', async () => {
    supabase.verifyOtp.mockResolvedValue(WRONG_CODE);
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual(CODE_REFUSED);
    expect(leaf.readSignInPauseSeconds).toHaveBeenCalledTimes(1);
    expect(leaf.recordWrongSignInCode.mock.calls).toEqual([[signInIdentifierHash(ADDRESS)]]);
    const order = [leaf.readSignInPauseSeconds, supabase.verifyOtp, leaf.recordWrongSignInCode].map((call) => call.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((first, second) => first - second));
  });

  it('the wrong code that starts the pause is answered otp_sign_in_paused, not "that code is wrong"', async () => {
    supabase.verifyOtp.mockResolvedValue(WRONG_CODE);
    leaf.recordWrongSignInCode.mockResolvedValue(3600);
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual({ ok: false, error: 'otp_sign_in_paused', params: { minutes: 60, minutesText: '60' } });
  });

  it('counts a wrong phone code against the phone, as Supabase received it', async () => {
    supabase.verifyOtp.mockResolvedValue(WRONG_CODE);
    await verifyOtpCore({ channel: 'phone', identifier: PHONE, token: '654321' });
    expect(leaf.readSignInPauseSeconds.mock.calls).toEqual([[signInIdentifierHash(PHONE)]]);
    expect(leaf.recordWrongSignInCode.mock.calls).toEqual([[signInIdentifierHash(PHONE)]]);
  });

  it('a code of the wrong shape reaches neither the counter nor Supabase', async () => {
    expect((await verifyOtpCore({ ...EMAIL_CHECK, token: '123' })).error).toBe('check_fields');
    expect(leaf.readSignInPauseSeconds).not.toHaveBeenCalled();
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
    expect(supabase.create).not.toHaveBeenCalled();
  });

  it('a Supabase rate limit or a rejected fetch is not a wrong code: nothing is recorded (AC31)', async () => {
    supabase.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { code: 'over_request_rate_limit', status: 429 } });
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual({ ok: false, error: 'otp_verify_rate_limited' });
    supabase.verifyOtp.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(verifyOtpCore(EMAIL_CHECK)).rejects.toThrow('fetch failed');
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
  });

  it('a counter that cannot be read does not stop a sign-in (AC29)', async () => {
    leaf.readSignInPauseSeconds.mockRejectedValue(new Error('connection ended'));
    expect(await verifyOtpCore(EMAIL_CHECK)).toEqual({ ok: true, next: '/dashboard' });
    expect(supabase.verifyOtp).toHaveBeenCalledTimes(1);
  });
});
