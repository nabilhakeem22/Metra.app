import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { useUndoableRemoval } from './use-undoable-removal';

const undoToast = vi.hoisted(() => ({ onUndo: null as null | (() => void) }));
vi.mock('./undo-toast', () => ({
  UNDO_WINDOW_MS: 5000,
  showUndoToast: (options: { onUndo: () => void }) => {
    undoToast.onUndo = options.onUndo;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  undoToast.onUndo = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

describe('useUndoableRemoval', () => {
  test('hides the row at once and offers Undo', () => {
    const { hook } = setup();
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(true);
    expect(undoToast.onUndo).not.toBeNull();
  });

  test('Undo before 5000 ms: the delete never runs and the row is back', async () => {
    const { hook, commit } = setup();
    await act(async () => vi.advanceTimersByTime(4000));
    act(() => undoToast.onUndo?.());
    await act(async () => vi.advanceTimersByTime(5000));
    expect(commit).not.toHaveBeenCalled();
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(false);
  });

  test('no Undo: the delete runs exactly once, at 5000 ms', async () => {
    const { commit, onCommitted } = setup();
    await act(async () => vi.advanceTimersByTime(4999));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('row-1');
    expect(onCommitted).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test('leaving the screen at 1000 ms commits the pending delete once', async () => {
    const { hook, commit } = setup();
    await act(async () => vi.advanceTimersByTime(1000));
    hook.unmount();
    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test('a refused delete brings the row back and reports the failure', async () => {
    const refused: ActionResult = { ok: false, error: 'forbidden' };
    const { hook, onFailed, onCommitted } = setup(refused);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(hook.result.current.hiddenIds.has('row-1')).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(refused);
    expect(onCommitted).not.toHaveBeenCalled();
  });
});
