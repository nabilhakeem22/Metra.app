import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SIGN_OUT_FLUSH_TIMEOUT_MS,
  signOutAfterPendingWrites,
} from './sign-out-after-pending-writes';

const flush = vi.hoisted(() => ({ fn: vi.fn<() => Promise<boolean>>() }));
vi.mock('@/hooks/pending-removals', () => ({ flushPendingRemovals: () => flush.fn() }));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/actions', () => auth);

beforeEach(() => {
  vi.useFakeTimers();
  auth.signOut.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('signOutAfterPendingWrites', () => {
  test('pending deletes are committed and answered before the session is cleared', async () => {
    let answer!: (landed: boolean) => void;
    flush.fn.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const done = signOutAfterPendingWrites();
    await vi.advanceTimersByTimeAsync(100);
    expect(auth.signOut).not.toHaveBeenCalled();
    answer(true);
    await done;
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  test('a delete that never answers holds sign-out for at most the cap', async () => {
    flush.fn.mockImplementation(() => new Promise(() => {}));
    const done = signOutAfterPendingWrites();
    await vi.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_TIMEOUT_MS - 1);
    expect(auth.signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  test('a flush that throws still signs out', async () => {
    flush.fn.mockRejectedValue(new Error('callback threw'));
    await signOutAfterPendingWrites();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
