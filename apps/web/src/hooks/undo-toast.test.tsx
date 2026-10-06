import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UNDO_HARD_CAP_MS, showUndoToast } from './undo-toast';
import { useToast } from './use-toast';

// No Toaster is rendered, so Radix's own (pausable) timer never runs: this is
// the toast that is hovered, focused or sitting in a blurred window for ever.

let toastApi: ReturnType<typeof useToast> | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  toastApi = renderHook(() => useToast()).result.current;
});

afterEach(() => {
  act(() => toastApi?.dismiss());
  act(() => vi.advanceTimersByTime(UNDO_HARD_CAP_MS));
  cleanup();
  vi.useRealTimers();
});

function show() {
  const onUndo = vi.fn();
  const onExpire = vi.fn();
  act(() => {
    showUndoToast({ title: 'Removed', undoLabel: 'Undo', onUndo, onExpire });
  });
  return { onUndo, onExpire };
}

describe('showUndoToast: the hard cap', () => {
  test('a toast that never closes on its own expires once at the cap, not a tick before', () => {
    const { onExpire } = show();
    act(() => vi.advanceTimersByTime(UNDO_HARD_CAP_MS - 1));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(UNDO_HARD_CAP_MS));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  test('Undo pressed at 29 s: the delete never commits', () => {
    const { onUndo, onExpire } = show();
    act(() => vi.advanceTimersByTime(29_000));
    const raised = renderHook(() => useToast()).result.current.toasts[0]!;
    const undoButton = raised.action as unknown as ReactElement<{ onClick: () => void }>;
    act(() => {
      undoButton.props.onClick();
      raised.onOpenChange?.(false);
    });
    act(() => vi.advanceTimersByTime(UNDO_HARD_CAP_MS));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
  });

  test('a toast closed early does not fire again at the cap', () => {
    const { onExpire } = show();
    act(() => toastApi?.dismiss());
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(UNDO_HARD_CAP_MS));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
