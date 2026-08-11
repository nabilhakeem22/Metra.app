'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { markTourSeen, setTourStep } from '@/lib/onboarding/state';
import type { TourStep } from '@/lib/onboarding/tour-steps';
import { Coachmark } from './coachmark';
import { TourContext, type TourApi } from './use-tour';

export interface TourProviderProps {
  initialSeen: boolean;
  initialStep: string | null;
  steps: TourStep[];
  /** Suppress the coachmark (e.g. while the mobile drawer is open). */
  paused?: boolean;
  children: React.ReactNode;
}

export function TourProvider({
  initialSeen,
  initialStep,
  steps,
  paused,
  children,
}: TourProviderProps) {
  const sorted = useMemo(
    () => [...steps].sort((a, b) => a.order - b.order),
    [steps],
  );
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const bootstrapped = useRef(false);

  const goToIndex = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(i, sorted.length - 1));
      setIndex(clamped);
      const step = sorted[clamped];
      if (!step) return;
      void setTourStep(step.id);
      if (step.page !== pathname) router.push(step.page);
    },
    [sorted, pathname, router],
  );

  const start = useCallback(
    (fromStepId?: string) => {
      const i = fromStepId
        ? Math.max(0, sorted.findIndex((s) => s.id === fromStepId))
        : 0;
      setActive(true);
      setIndex(i);
      const step = sorted[i];
      if (step) {
        void setTourStep(step.id);
        if (step.page !== pathname) router.push(step.page);
      }
    },
    [sorted, pathname, router],
  );

  const stop = useCallback(() => {
    setActive(false);
    void setTourStep(null); // don't resume on next load
  }, []);

  const next = useCallback(() => {
    if (index >= sorted.length - 1) {
      setActive(false);
      void markTourSeen(null);
      return;
    }
    goToIndex(index + 1);
  }, [index, sorted.length, goToIndex]);

  const prev = useCallback(() => {
    if (index > 0) goToIndex(index - 1);
  }, [index, goToIndex]);

  const goto = useCallback(
    (id: string) => {
      const i = sorted.findIndex((s) => s.id === id);
      if (i >= 0) {
        setActive(true);
        goToIndex(i);
      }
    },
    [sorted, goToIndex],
  );

  // Auto-start (md+, first entry) OR resume — exactly once.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const mdPlus =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 768px)').matches;

    if (!initialSeen && mdPlus) {
      setActive(true);
      setIndex(0);
      // Mark seen immediately so a reload never re-autostarts.
      void markTourSeen(sorted[0]?.id ?? null);
      const step0 = sorted[0];
      if (step0 && step0.page !== pathname) router.push(step0.page);
    } else if (initialSeen && initialStep) {
      const i = sorted.findIndex((s) => s.id === initialStep);
      if (i >= 0) {
        setActive(true);
        setIndex(i);
        const step = sorted[i];
        if (step && step.page !== pathname) router.push(step.page);
      }
    }
  }, [initialSeen, initialStep, sorted, pathname, router]);

  const current = active ? (sorted[index] ?? null) : null;
  const api: TourApi = {
    active,
    current,
    index,
    total: sorted.length,
    start,
    stop,
    next,
    prev,
    goto,
  };

  return (
    <TourContext.Provider value={api}>
      {children}
      <Coachmark paused={paused} />
    </TourContext.Provider>
  );
}
