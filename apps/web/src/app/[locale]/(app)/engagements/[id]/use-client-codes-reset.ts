'use client';

import { useState, useTransition } from 'react';
import type { ShownFailure } from '@/lib/actions/error-message';
import { resetClientCodes } from '@/lib/client-home/actions';

/** The reset's last answer: done (with how many codes it voided), or what refused it. */
export type CodesResetOutcome = { done: true; voided: number } | { done: false; failure: ShownFailure };

export interface ClientCodesResetApi {
  pending: boolean;
  outcome: CodesResetOutcome | null;
  /** Reset the client's codes on this delivery (the caller asks first). */
  reset: () => void;
}

/**
 * The behaviour behind "Reset the client's codes" (H5 security S1): one call
 * of resetClientCodes, its await wrapped so a rejected action shows as a
 * failure and never strands the spinner.
 */
export function useClientCodesReset(engagementId: string): ClientCodesResetApi {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CodesResetOutcome | null>(null);
  return {
    pending,
    outcome,
    reset: () => {
      setOutcome(null);
      startTransition(async () => {
        try {
          const result = await resetClientCodes(engagementId);
          setOutcome(result.ok && result.data ? { done: true, voided: result.data.voided } : { done: false, failure: result });
        } catch (rejection) {
          setOutcome({ done: false, failure: { rejection } });
        }
      });
    },
  };
}
