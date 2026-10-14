'use client';

import { useTranslations } from 'next-intl';
import { describeFailure } from '@/lib/actions/error-message';
import type { ActionFailure } from './run-action';

/**
 * A refused card action, said where it was refused: inside the card, directly
 * under the action, not below the card where the eye has already left. An
 * unknown failure carries its reference.
 */
export function CommandCardActionError({ error }: { error: ActionFailure | null }) {
  const te = useTranslations('errors');
  if (!error) return null;
  return (
    <p className="mt-3 text-body text-destructive" role="alert">
      {describeFailure(error, te)}
    </p>
  );
}
