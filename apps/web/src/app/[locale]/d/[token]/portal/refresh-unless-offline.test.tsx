import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshUnlessOffline } from './refresh-unless-offline';

afterEach(() => vi.restoreAllMocks());

describe('refreshUnlessOffline (F6)', () => {
  it('refreshes once while the phone reports a network', () => {
    const refresh = vi.fn();
    refreshUnlessOffline(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the page alone while the phone reports none', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const refresh = vi.fn();
    refreshUnlessOffline(refresh);
    expect(refresh).not.toHaveBeenCalled();
  });
});
