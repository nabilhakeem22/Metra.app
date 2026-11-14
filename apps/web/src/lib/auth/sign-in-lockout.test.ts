import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in pause policy (security batch 3, P2; AC28 to AC31, AC33). The
// database leaf and the Cloudflare runtime are doubles; the hash, the failure
// modes and the mapping of a refused code run for real.

vi.mock('server-only', () => ({}));
const runtime = vi.hoisted(() => ({ cloudflare: false, env: {} as Record<string, unknown> }));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => runtime.cloudflare, cfEnv: () => runtime.env }));
const leaf = vi.hoisted(() => ({ readSignInPauseSeconds: vi.fn(), recordWrongSignInCode: vi.fn() }));
vi.mock('./sign-in-failures-db', () => leaf);

const { failedVerifyAnswer, signInIdentifierHash, signInPauseRefusal } = await import('./sign-in-lockout');

const ADDRESS = 'mona@firm.example';
// sha256 of 'sign-in:mona@firm.example': what the owner's lift statement computes in SQL (docs/DEPLOY.md).
const ADDRESS_HASH = '20425756b845430b1e8abe7e8c3e8cf2726ef50ddce74bb229b8203e0fecd2f6';
const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const WRONG_CODE = { code: 'otp_expired', status: 403 };
const CODE_REFUSED = { ok: false, error: 'check_fields', fields: { token: { code: 'otp_verify_failed' } } };

/** A failure that carries the address and its hash everywhere a log line could pick them up. */
function leakyFailure(): Error {
  return Object.assign(new Error(`lookup of ${ADDRESS_HASH} for ${ADDRESS} failed`), { code: '57014', table_name: ADDRESS });
}

let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
const loggedText = () => JSON.stringify([errors.mock.calls, warnings.mock.calls]);

beforeEach(() => {
  runtime.cloudflare = false;
  runtime.env = {};
  leaf.readSignInPauseSeconds.mockReset().mockResolvedValue(null);
  leaf.recordWrongSignInCode.mockReset().mockResolvedValue(null);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('signInIdentifierHash (AC33)', () => {
  it('is 64 lower-case hex characters, stable, and different for two identifiers', () => {
    expect(signInIdentifierHash(ADDRESS)).toMatch(/^[0-9a-f]{64}$/);
    expect(signInIdentifierHash(ADDRESS)).toBe(signInIdentifierHash(ADDRESS));
    expect(signInIdentifierHash('+201001234567')).not.toBe(signInIdentifierHash(ADDRESS));
  });

  it("is sha256 of 'sign-in:' and the identifier, the value the lift statement deletes by", () => {
    expect(signInIdentifierHash(ADDRESS)).toBe(ADDRESS_HASH);
    expect(signInIdentifierHash('+201001234567')).toBe('bf59ab2d951f79a0aac2e7f9f920b47b47e4900f41e48bf0c3213e4b8358dd7d');
  });
});

describe('signInPauseRefusal', () => {
  it('answers null for an identifier that is not paused, after one read by its hash', async () => {
    expect(await signInPauseRefusal(ADDRESS)).toBeNull();
    expect(leaf.readSignInPauseSeconds.mock.calls).toEqual([[ADDRESS_HASH]]);
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('refuses a paused identifier with otp_sign_in_paused and the minutes left (AC28)', async () => {
    leaf.readSignInPauseSeconds.mockResolvedValue(1800);
    expect(await signInPauseRefusal(ADDRESS)).toEqual({ ok: false, error: 'otp_sign_in_paused', params: { minutes: 30, minutesText: '30' } });
    expect(loggedText()).toBe('[[],[]]');
  });

  it.each([
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
    [3541, 60],
    [3600, 60],
  ])('rounds %i seconds up to %i whole minutes', async (seconds, minutes) => {
    leaf.readSignInPauseSeconds.mockResolvedValue(seconds);
    expect((await signInPauseRefusal(ADDRESS))?.params).toEqual({ minutes, minutesText: String(minutes) });
  });

  it('lets the check go ahead when the read throws, with one log line that carries neither the address nor its hash (AC29)', async () => {
    leaf.readSignInPauseSeconds.mockRejectedValue(leakyFailure());
    expect(await signInPauseRefusal(ADDRESS)).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toBe('sign-in pause check failed');
    expect(errors.mock.calls[0]![1]).toEqual({ error: expect.objectContaining({ code: '57014' }) });
    expect(loggedText()).not.toContain(ADDRESS);
    expect(loggedText()).not.toContain(ADDRESS_HASH);
  });

  it.each([
    ['no HYPERDRIVE binding', {}],
    ['a HYPERDRIVE binding without a connection string', { HYPERDRIVE: {} }],
  ])('on Cloudflare with %s, refuses with a referenced generic and never asks the database (AC30)', async (_case, env) => {
    runtime.cloudflare = true;
    runtime.env = env;
    const refused = await signInPauseRefusal(ADDRESS);
    expect(refused).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(leaf.readSignInPauseSeconds).not.toHaveBeenCalled();
    expect(errors.mock.calls).toEqual([['sign-in pause store missing', expect.objectContaining({ reference: refused?.reference })]]);
    expect(loggedText()).not.toContain(ADDRESS);
  });

  it('on Cloudflare with the binding present, reads the pause as anywhere else', async () => {
    runtime.cloudflare = true;
    runtime.env = { HYPERDRIVE: { connectionString: 'hyperdrive-double' } };
    leaf.readSignInPauseSeconds.mockResolvedValue(120);
    expect((await signInPauseRefusal(ADDRESS))?.error).toBe('otp_sign_in_paused');
  });
});

describe('failedVerifyAnswer (AC31)', () => {
  it('counts a wrong or expired code once and answers otp_verify_failed while the identifier is not paused', async () => {
    expect(await failedVerifyAnswer(ADDRESS, 'verifyEmailOtp failed', WRONG_CODE)).toEqual(CODE_REFUSED);
    expect(leaf.recordWrongSignInCode.mock.calls).toEqual([[ADDRESS_HASH]]);
    expect(leaf.readSignInPauseSeconds).not.toHaveBeenCalled();
    expect(errors.mock.calls).toEqual([['verifyEmailOtp failed', WRONG_CODE]]);
    expect(warnings).not.toHaveBeenCalled();
  });

  it('answers otp_sign_in_paused when the count starts a pause, with one warning that names nobody', async () => {
    leaf.recordWrongSignInCode.mockResolvedValue(3600);
    expect(await failedVerifyAnswer(ADDRESS, 'verifyEmailOtp failed', WRONG_CODE)).toEqual({
      ok: false,
      error: 'otp_sign_in_paused',
      params: { minutes: 60, minutesText: '60' },
    });
    expect(leaf.recordWrongSignInCode).toHaveBeenCalledTimes(1);
    expect(warnings.mock.calls).toEqual([['sign-in paused after wrong codes']]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('still answers otp_verify_failed when the count throws, with one more log line that carries neither the address nor its hash', async () => {
    leaf.recordWrongSignInCode.mockRejectedValue(leakyFailure());
    expect(await failedVerifyAnswer(ADDRESS, 'verifyEmailOtp failed', WRONG_CODE)).toEqual(CODE_REFUSED);
    expect(leaf.recordWrongSignInCode).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.map(([label]) => label)).toEqual(['sign-in failure record failed', 'verifyEmailOtp failed']);
    expect(loggedText()).not.toContain(ADDRESS);
    expect(loggedText()).not.toContain(ADDRESS_HASH);
  });

  it.each([
    ['a Supabase rate limit', { code: 'over_request_rate_limit', status: 429 }, { ok: false, error: 'otp_verify_rate_limited' }],
    ['an unknown code', { code: 'unexpected_failure', status: 500 }, { ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) }],
    ['a failed fetch, which carries no code', { status: 0 }, { ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) }],
  ])('never counts %s', async (_case, failure, answer) => {
    expect(await failedVerifyAnswer(ADDRESS, 'verifyEmailOtp failed', failure)).toEqual(answer);
    expect(leaf.recordWrongSignInCode).not.toHaveBeenCalled();
    expect(leaf.readSignInPauseSeconds).not.toHaveBeenCalled();
  });
});
