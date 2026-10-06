import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { flushPendingRemovals, hasPendingRemovals } from './pending-removals';
import { useUndoableRemoval } from './use-undoable-removal';

// The toast is the hook's clock; here it is a double whose close we drive.
const toastDouble = vi.hoisted(() => ({
  onUndo: null as null | (() => void),
  onExpire: null as null | (() => void),
  dismiss: (() => {}) as () => void,
  dismissCalls: 0,
}));
vi.mock('./undo-toast', () => ({
  showUndoToast: (options: { onUndo: () => void; onExpire?: () => void }) => {
    toastDouble.onUndo = options.onUndo;
    toastDouble.onExpire = options.onExpire ?? null;
    return {
      dismiss: () => {
        toastDouble.dismissCalls += 1;
      },
    };
  },
}));

afterEach(() => {
  cleanup();
  toastDouble.onUndo = null;
  toastDouble.onExpire = null;
  toastDouble.dismissCalls = 0;
});

function setup(result: ActionResult = { ok: true }) {
  const commit = vi.fn(async (_id: string) => result);
  const onFailed = vi.fn();
  const onCommitted = vi.fn();
  const hook = renderHook(() =>
    useUndoableRemoval({
      commit,
      messages: { removed: 'Removed', undo: 'Undo' },
      onCommitted,
      onFailed,
    }),
  );
  act(() => hook.result.current.remove('row-1'));
  return { hook, commit, onFailed, onCommitted };
}

describe('useUndoableRemoval: the Undo toast is the only clock', () => {
  test('hides the row at once, offers Undo, and deletes nothing yet', () => {
    const { hook, commit } = setup();
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(true);
    expect(toastDouble.onUndo).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  test('Undo: the delete never runs and the row is back', async () => {
    const { hook, commit } = setup();
    act(() => toastDouble.onUndo?.());
    await act(async () => toastDouble.onExpire?.());
    expect(commit).not.toHaveBeenCalled();
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(false);
  });

  test('the toast closing without Undo commits exactly once', async () => {
    const { commit, onCommitted } = setup();
    await act(async () => toastDouble.onExpire?.());
    await act(async () => toastDouble.onExpire?.());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('row-1');
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  test('leaving the screen commits once, closes the toast, then refreshes', async () => {
    const { hook, commit, onCommitted } = setup();
    hook.unmount();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(toastDouble.dismissCalls).toBe(1);
    await act(async () => {});
    expect(onCommitted).toHaveBeenCalledTimes(1);
    // A stale Undo, had it been clicked anyway, does nothing.
    act(() => toastDouble.onUndo?.());
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test('the page going to the background commits now', async () => {
    const { commit } = setup();
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    hidden.mockRestore();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(toastDouble.dismissCalls).toBe(1);
  });

  test('pagehide commits now', async () => {
    const { commit } = setup();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test('the app-wide flush commits, closes the toast and waits for the answer', async () => {
    const { commit } = setup();
    expect(hasPendingRemovals()).toBe(true);
    await act(async () => flushPendingRemovals());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(toastDouble.dismissCalls).toBe(1);
    expect(hasPendingRemovals()).toBe(false);
  });

  test('a delete already sent holds the app-wide flush until the server answers', async () => {
    let answer!: (result: ActionResult) => void;
    const commit = vi.fn(() => new Promise<ActionResult>((resolve) => (answer = resolve)));
    const hook = renderHook(() =>
      useUndoableRemoval({
        commit,
        messages: { removed: 'Removed', undo: 'Undo' },
        onFailed: () => {},
      }),
    );
    act(() => hook.result.current.remove('row-1'));
    act(() => toastDouble.onExpire?.());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(hasPendingRemovals()).toBe(true);

    let flushed = false;
    const flushing = flushPendingRemovals().then((landed) => (flushed = landed));
    await act(async () => {});
    expect(flushed).toBe(false);
    expect(hasPendingRemovals()).toBe(true);

    await act(async () => answer({ ok: true }));
    await flushing;
    expect(flushed).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(hasPendingRemovals()).toBe(false);
  });

  test('a refused delete brings the row back and reports it', async () => {
    const refused: ActionResult = { ok: false, error: 'forbidden' };
    const { hook, onFailed, onCommitted } = setup(refused);
    await act(async () => toastDouble.onExpire?.());
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(refused);
    expect(onCommitted).not.toHaveBeenCalled();
  });
});
