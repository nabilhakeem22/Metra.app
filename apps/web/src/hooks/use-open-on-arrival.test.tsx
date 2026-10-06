import { describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOpenOnArrival } from './use-open-on-arrival';

describe('useOpenOnArrival', () => {
  test('opens once for a permitted arrival, and not again on re-render', () => {
    const open = vi.fn();
    const { rerender } = renderHook(({ should }) => useOpenOnArrival(should, open), {
      initialProps: { should: true },
    });
    rerender({ should: true });
    rerender({ should: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('never opens when the arrival is not permitted (or not a deep link)', () => {
    const open = vi.fn();
    const { rerender } = renderHook(({ should }) => useOpenOnArrival(should, open), {
      initialProps: { should: false },
    });
    rerender({ should: false });
    expect(open).not.toHaveBeenCalled();
  });
});
