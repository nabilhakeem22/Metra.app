'use client';

import { useTranslations } from 'next-intl';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';

/**
 * A refused card action, said where it was refused: inside the card, directly
 * under the action, not below the card where the eye has already left.
 */
export function CommandCardActionError({ error }: { error: ActionCode | null }) {
  const te = useTranslations('errors');
  if (!error) return null;
  return (
    <p className="mt-3 text-body text-destructive" role="alert">
      {resolveActionError(error, te)}
    </p>
  );
}
