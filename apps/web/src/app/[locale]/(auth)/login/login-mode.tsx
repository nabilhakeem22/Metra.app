'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

/** The framing a `?mode=signup` search param picks. */
function ModeFromSearch({ signin, signup }: { signin: ReactNode; signup: ReactNode }) {
  return useSearchParams().get('mode') === 'signup' ? signup : signin;
}

/**
 * One piece of sign-in vs create-account framing. The login page is pre-rendered
 * to a static asset, where there is no search string, so the HTML carries the
 * sign-in framing (the Suspense fallback) and `?mode=signup` swaps it after
 * hydration. Only the framing sits under the boundary: the form state is outside
 * every Suspense, so it is never remounted.
 */
export function ByLoginMode({ signin, signup }: { signin: ReactNode; signup: ReactNode }) {
  return (
    <Suspense fallback={signin}>
      <ModeFromSearch signin={signin} signup={signup} />
    </Suspense>
  );
}
