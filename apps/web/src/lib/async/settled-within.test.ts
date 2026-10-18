import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settledWithin } from './settled-within';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('settledWithin', () => {
  it('is true for work that resolves or rejects in time, and clears its timer', async () => {
    expect(await settledWithin(Promise.resolve('done'), 1_000)).toBe(true);
    expect(await settledWithin(Promise.reject(new Error('failed')), 1_000)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is false for work still running at the bound, which it leaves running', async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const waited = settledWithin(work, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await waited).toBe(false);
    finish();
    await expect(work).resolves.toBeUndefined();
  });
});
