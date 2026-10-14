'use client';

import { useTranslations } from 'next-intl';
import { describePortalFailure, type ShownPortalFailure } from '@/lib/share/portal-failure';

/**
 * The line a client link page (/p, /c, /v) shows when the client's answer did
 * not land: the decision is still open, the buttons stay, and the sentence says
 * what happened and what to do (with the reference of an unknown failure).
 */
export function PortalFailureAlert({ failure }: { failure: ShownPortalFailure | null }) {
  const t = useTranslations('portal.errors');
  if (!failure) return null;
  return (
    <p role="alert" className="text-center text-body text-destructive">
      {describePortalFailure(failure, t)}
    </p>
  );
}
