import { afterEach, describe, expect, it, vi } from 'vitest';

// Round D fix round (R1, S1): a limiter that does not answer, or answers
// something that is not `{ success: boolean }`, fails OPEN and is logged by
// binding name, never with the key.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => true, cfEnv: () => ({}) }));

const { consumeRateLimit, RATE_LIMIT_DEADLINE_MS } = await import('./rate-limit-binding');

const KEY = '0123456789abcdef0123456789abcdef';
const BINDING = 'PORTAL_ACT_RATE_LIMITER';

function answering(answer: unknown) {
  return { limit: vi.fn(async () => answer as { success: boolean }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('consumeRateLimit', () => {
  it('passes the verdict of a well-formed answer through', async () => {
    expect(await consumeRateLimit(answering({ success: true }), KEY, BINDING)).toBe(true);
    expect(await consumeRateLimit(answering({ success: false }), KEY, BINDING)).toBe(false);
  });

  it('a limiter that never answers is allowed at the deadline, logged once by binding, timer cleared', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const never = { limit: vi.fn(() => new Promise<{ success: boolean }>(() => {})) };
    const verdict = consumeRateLimit(never, KEY, BINDING);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_DEADLINE_MS - 1);
    expect(log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await verdict).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('timeout');
    expect(log.mock.calls[0][1]).toEqual({ binding: BINDING, deadlineMs: RATE_LIMIT_DEADLINE_MS });
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an answer within the deadline leaves no timer behind', async () => {
    vi.useFakeTimers();
    expect(await consumeRateLimit(answering({ success: false }), KEY, BINDING)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers in real time (well under a second) against a never-answering limiter', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const started = Date.now();
    expect(await consumeRateLimit({ limit: () => new Promise(() => {}) }, KEY, BINDING)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.each([[{ success: 'false' }], [{}], [{ success: 0 }], [null], [undefined], ['yes']])(
    'a malformed answer %j is allowed and logged by binding, without the key',
    async (answer) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await consumeRateLimit(answering(answer), KEY, BINDING)).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][1]).toEqual({ binding: BINDING });
    },
  );

  it('a throwing limiter is allowed and logged with the binding, the key cut out', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = { limit: vi.fn(async () => Promise.reject(new Error(`bucket ${KEY} unavailable`))) };
    expect(await consumeRateLimit(throwing, KEY, BINDING)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toMatchObject({ binding: BINDING, message: 'bucket [key] unavailable' });
  });

  it('no limiter (off-platform) is allowed without a word', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await consumeRateLimit(null, KEY, BINDING)).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});
