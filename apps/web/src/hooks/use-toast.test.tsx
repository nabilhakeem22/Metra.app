import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast, useToast } from './use-toast';

// Each case starts from an empty store: the store is module state, and an
// error toast stays open until dismissed, so one case's toast would collapse
// the next case's identical one.
beforeEach(() => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useToast());
  act(() => result.current.dismiss());
  act(() => vi.advanceTimersByTime(10_000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function raise(input: Parameters<typeof toast>[0]) {
  const { result } = renderHook(() => useToast());
  let id = '';
  act(() => {
    id = toast(input).id;
  });
  return result.current.toasts.find((raised) => raised.id === id)!;
}

describe('toast() defaults by kind', () => {
  test('an error stays until dismissed', () => {
    expect(raise({ title: 'Refused', variant: 'destructive' }).duration).toBe(Infinity);
  });

  test('anything else is announced politely', () => {
    const raised = raise({ title: 'Saved' });
    expect(raised.type).toBe('background');
    expect(raised.duration).toBeUndefined();
  });

  test("a caller's explicit duration and type still win", () => {
    expect(raise({ title: 'Refused', variant: 'destructive', duration: 4000 }).duration).toBe(4000);
    expect(raise({ title: 'Heads up', type: 'foreground' }).type).toBe('foreground');
  });
});

describe('toast(): identical errors collapse', () => {
  function openToasts() {
    return renderHook(() => useToast()).result.current.toasts.filter((shown) => shown.open);
  }

  test('five identical errors leave one toast, and every call gets its handle', () => {
    let first = '';
    let second = '';
    act(() => {
      first = toast({ title: 'Refused', description: 'No access', variant: 'destructive' }).id;
      for (let repeat = 0; repeat < 4; repeat += 1) {
        second = toast({ title: 'Refused', description: 'No access', variant: 'destructive' }).id;
      }
    });
    expect(openToasts()).toHaveLength(1);
    expect(second).toBe(first);
  });

  test('a different description is its own toast', () => {
    act(() => {
      toast({ title: 'Refused', description: 'No access', variant: 'destructive' });
      toast({ title: 'Refused', description: 'Too late', variant: 'destructive' });
    });
    expect(openToasts()).toHaveLength(2);
  });

  test('an error carrying an action is never collapsed', () => {
    act(() => {
      toast({ title: 'Refused', variant: 'destructive', action: <button type="button">Retry</button> as never });
      toast({ title: 'Refused', variant: 'destructive', action: <button type="button">Retry</button> as never });
    });
    expect(openToasts()).toHaveLength(2);
  });

  test('a success toast is never collapsed', () => {
    act(() => {
      toast({ title: 'Saved' });
      toast({ title: 'Saved' });
    });
    expect(openToasts()).toHaveLength(2);
  });
});
