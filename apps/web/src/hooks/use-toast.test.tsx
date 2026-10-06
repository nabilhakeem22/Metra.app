import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { toast, useToast } from './use-toast';

afterEach(() => {
  cleanup();
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
