'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * While `enabled`, a window focus calls `refresh` when the last refresh is older
 * than `afterMs` (another tab or person may have changed what is shown). Every
 * refresh, whoever starts it, calls the returned `markRefreshed`, so a focus
 * right after an open does not read again.
 */
export function useRefreshOnFocus(
  enabled: boolean,
  afterMs: number,
  refresh: () => void,
): { markRefreshed: () => void } {
  const refreshedAt = useRef(0);
  const latestRefresh = useRef(refresh);

  useEffect(() => {
    latestRefresh.current = refresh;
  });

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => {
      if (Date.now() - refreshedAt.current > afterMs) latestRefresh.current();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, afterMs]);

  const markRefreshed = useCallback(() => {
    refreshedAt.current = Date.now();
  }, []);
  return { markRefreshed };
}
