'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Countdown {
  remaining: number;
  /** 'm:ss', Western numerals. */
  formatted: string;
  isRunning: boolean;
  start: (seconds?: number) => void;
  reset: () => void;
}

export function useCountdown(initialSeconds: number): Countdown {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(
    (seconds?: number) => {
      clear();
      setRemaining(seconds ?? initialSeconds);
      timer.current = setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clear();
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    },
    [clear, initialSeconds],
  );

  const reset = useCallback(() => {
    clear();
    setRemaining(0);
  }, [clear]);

  // Clear on unmount.
  useEffect(() => clear, [clear]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return { remaining, formatted, isRunning: remaining > 0, start, reset };
}
