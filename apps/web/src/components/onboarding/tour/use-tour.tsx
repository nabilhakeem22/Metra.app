'use client';

import { createContext, useContext } from 'react';
import type { TourStep } from '@/lib/onboarding/tour-steps';

export interface TourApi {
  active: boolean;
  current: TourStep | null;
  index: number;
  total: number;
  start: (fromStepId?: string) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goto: (id: string) => void;
}

export const TourContext = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  const ctx = useContext(TourContext);
  if (!ctx) {
    // A no-op API when rendered outside a provider (e.g. the public share page).
    return {
      active: false,
      current: null,
      index: 0,
      total: 0,
      start: () => {},
      stop: () => {},
      next: () => {},
      prev: () => {},
      goto: () => {},
    };
  }
  return ctx;
}
