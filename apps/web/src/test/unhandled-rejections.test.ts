import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectUnhandledRejections } from './unhandled-rejections';

afterEach(() => vi.useRealTimers());

describe('collectUnhandledRejections', () => {
  it('collects a rejection nobody handled, with its reason, and not one that was handled', async () => {
    const unhandled = collectUnhandledRejections();
    const lost = new Error('nobody caught this');
    void Promise.reject(lost);
    Promise.reject(new Error('caught')).catch(() => undefined);
    const reasons = await unhandled.stop();
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe(lost);
  });

  it('collects under fake timers too, and one raised from a later microtask', async () => {
    vi.useFakeTimers();
    const unhandled = collectUnhandledRejections();
    void Promise.resolve().then(() => {
      void Promise.reject(new Error('later'));
    });
    expect(await unhandled.stop()).toEqual([new Error('later')]);
  });

  it('hands the runner its own listeners back, the same ones in the same order', async () => {
    const before = process.listeners('unhandledRejection');
    const unhandled = collectUnhandledRejections();
    expect(process.listeners('unhandledRejection')).toHaveLength(1);
    await unhandled.stop();
    expect(process.listeners('unhandledRejection')).toEqual(before);
  });
});
