import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The sign-in pause must never hold a code check for the length of a database
// incident. Sign-in did not touch Postgres before the pause existed; the
// request database's own deadline is 15 s, which a stalled database would have
// spent once on every right code and twice on every wrong one. Both counter
// calls give up after SIGN_IN_PAUSE_DEADLINE_MS and the check goes on without
// them (fail open, like a database error). The other failure modes are in
// sign-in-lockout.test.ts.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => false, cfEnv: () => ({}) }));
const leaf = vi.hoisted(() => ({ readSignInPauseSeconds: vi.fn(), recordWrongSignInCode: vi.fn() }));
vi.mock('./sign-in-failures-db', () => leaf);

const { SIGN_IN_PAUSE_DEADLINE_MS, failedVerifyAnswer, signInPauseRefusal } = await import('./sign-in-lockout');

const ADDRESS = 'mona@firm.example';
const WRONG_CODE = { code: 'otp_expired', status: 403 };
const CODE_REFUSED = { ok: false, error: 'check_fields', fields: { token: { code: 'otp_verify_failed' } } };
const neverAnswers = () => new Promise<never>(() => {});

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  leaf.readSignInPauseSeconds.mockReset().mockImplementation(neverAnswers);
  leaf.recordWrongSignInCode.mockReset().mockImplementation(neverAnswers);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a database that does not answer', () => {
  it('waits two seconds at most, far below the request database deadline', () => {
    expect(SIGN_IN_PAUSE_DEADLINE_MS).toBe(2_000);
  });

  it('lets the code check go ahead once the pause read has waited its deadline, and not before', async () => {
    const settled = vi.fn();
    const refusal = signInPauseRefusal(ADDRESS).then((answer) => {
      settled(answer);
      return answer;
    });
    await vi.advanceTimersByTimeAsync(SIGN_IN_PAUSE_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await refusal).toBeNull();
    expect(errors.mock.calls.map(([label]) => label)).toEqual(['sign-in pause check failed']);
  });

  it('answers "that code is wrong" once the count has waited its deadline, and not before', async () => {
    const settled = vi.fn();
    const answer = failedVerifyAnswer(ADDRESS, 'verifyEmailOtp failed', WRONG_CODE).then((result) => {
      settled(result);
      return result;
    });
    await vi.advanceTimersByTimeAsync(SIGN_IN_PAUSE_DEADLINE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual(CODE_REFUSED);
    expect(errors.mock.calls.map(([label]) => label)).toEqual(['sign-in failure record failed', 'verifyEmailOtp failed']);
  });

  it('logs the deadline without the address', async () => {
    const refusal = signInPauseRefusal(ADDRESS);
    await vi.advanceTimersByTimeAsync(SIGN_IN_PAUSE_DEADLINE_MS);
    await refusal;
    expect(JSON.stringify(errors.mock.calls)).toContain(`sign-in pause check exceeded ${SIGN_IN_PAUSE_DEADLINE_MS}ms`);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(ADDRESS);
  });
});
