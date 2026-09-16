import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_TIMEOUT_MS,
  HttpDeadlineError,
  STORAGE_TIMEOUT_MS,
  withDeadline,
} from './deadlines';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withDeadline', () => {
  it('passes a result through, and leaves no timer behind', async () => {
    await expect(withDeadline(Promise.resolve('sent'), 5_000, 'x')).resolves.toBe('sent');
    // A fast success must not keep an isolate alive waiting for its own timer.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a rejection through unchanged — a failure is not a deadline', async () => {
    const failed = Promise.reject(new Error('resend 500'));
    await expect(withDeadline(failed, 5_000, 'x')).rejects.toThrow('resend 500');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with HttpDeadlineError once the wait runs out', async () => {
    const hung = new Promise<string>(() => {}); // never settles, like a dead origin
    const raced = withDeadline(hung, 5_000, 'sendProposalEmail');
    const caught = raced.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await caught;
    expect(error).toBeInstanceOf(HttpDeadlineError);
    expect((error as HttpDeadlineError).label).toBe('sendProposalEmail');
    expect((error as Error).message).toBe('sendProposalEmail exceeded 5000ms');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fire early', async () => {
    const settled = vi.fn();
    const hung = new Promise<string>(() => {});
    void withDeadline(hung, 5_000, 'x').catch(settled);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('keeps the two budgets apart, and both under a platform request budget', () => {
    // Email is best-effort and its answer is already committed; Storage also
    // carries a rendered PDF upload, so it gets the DB path's ceiling.
    expect(EMAIL_TIMEOUT_MS).toBeLessThan(STORAGE_TIMEOUT_MS);
    expect(STORAGE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });
});
