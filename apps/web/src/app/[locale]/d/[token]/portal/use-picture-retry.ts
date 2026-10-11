'use client';

import { useEffect, useState } from 'react';
import { PORTAL_RETRY_AFTER_SECONDS } from '@/lib/share/portal-retry-after';

/** The longest a failed picture waits before its one retry. */
const RETRY_CAP_SECONDS = 60;

/** How long a failed picture waits: the routes' Retry-After, capped. */
export const PICTURE_RETRY_DELAY_MS = Math.min(PORTAL_RETRY_AFTER_SECONDS, RETRY_CAP_SECONDS) * 1000;

type PictureAttempt = 'first' | 'waiting' | 'retry' | 'failed';

export interface PictureRetry {
  /** Render the `<img>` now (false while waiting and after the retry failed). */
  showPicture: boolean;
  /** A key for the `<img>`, so the retry is a fresh element and a fresh request. */
  attempt: number;
  onError: () => void;
}

/**
 * ONE more try for a picture that failed to load (Round D, reliability R2): a
 * tile refused by the link's per-link read budget (a 429) would otherwise stay
 * a placeholder for the page's life. An `<img>` cannot read the status, so any
 * first failure shows the placeholder, waits the routes' Retry-After and tries
 * once more; a really broken picture costs one more read, then the placeholder
 * stays. The timer exists only while the tile is mounted.
 */
export function usePictureRetry(): PictureRetry {
  const [attempt, setAttempt] = useState<PictureAttempt>('first');
  useEffect(() => {
    if (attempt !== 'waiting') return;
    const timer = setTimeout(() => setAttempt('retry'), PICTURE_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attempt]);
  return {
    showPicture: attempt === 'first' || attempt === 'retry',
    attempt: attempt === 'retry' ? 1 : 0,
    onError: () => setAttempt((current) => (current === 'first' ? 'waiting' : 'failed')),
  };
}
