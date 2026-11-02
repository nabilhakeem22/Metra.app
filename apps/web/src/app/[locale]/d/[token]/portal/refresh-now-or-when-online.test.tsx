import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshNowOrWhenOnline } from './refresh-now-or-when-online';

const online = () => window.dispatchEvent(new Event('online'));
const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

afterEach(() => vi.restoreAllMocks());

describe('refreshNowOrWhenOnline (F6, N1)', () => {
  it('refreshes at once while the phone reports a network, and leaves nothing for the next online event', () => {
    const refresh = vi.fn();
    refreshNowOrWhenOnline(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    online();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves the page alone while the phone reports none, and refreshes once on the next online event', () => {
    const offline = goOffline();
    const refresh = vi.fn();
    refreshNowOrWhenOnline(refresh);
    expect(refresh).not.toHaveBeenCalled();
    offline.mockRestore();
    online();
    expect(refresh).toHaveBeenCalledTimes(1);
    online();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once for however many acts asked, whichever function each passed', () => {
    const offline = goOffline();
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    refreshNowOrWhenOnline(first);
    refreshNowOrWhenOnline(second);
    refreshNowOrWhenOnline(third);
    offline.mockRestore();
    online();
    online();
    expect(first.mock.calls.length + second.mock.calls.length + third.mock.calls.length).toBe(1);
  });

  it('cannot loop: a refresh that asks again on the way back runs at once, once', () => {
    const offline = goOffline();
    const again = vi.fn();
    const refresh = vi.fn(() => refreshNowOrWhenOnline(again));
    refreshNowOrWhenOnline(refresh);
    offline.mockRestore();
    online();
    online();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('waits again when the phone drops once more after a refresh', () => {
    const offline = goOffline();
    const refresh = vi.fn();
    refreshNowOrWhenOnline(refresh);
    offline.mockRestore();
    online();
    const offlineAgain = goOffline();
    refreshNowOrWhenOnline(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    offlineAgain.mockRestore();
    online();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
