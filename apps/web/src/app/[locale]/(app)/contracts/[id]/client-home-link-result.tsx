'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ClientHomeShown } from './client-home-shown';

/**
 * The client home's link with its copy button, why there is none (a status),
 * or the refusal (an alert): what the "Client page" control and the issued
 * contract's card show alike. Egyptian copy.
 */
export function ClientHomeLinkResult({ shown }: { shown: ClientHomeShown }) {
  const t = useTranslations('contracts.clientPage');
  if ('link' in shown) {
    return (
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate" dir="ltr">
          {shown.link}
        </code>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(shown.link)}>
          {t('copy')}
        </Button>
      </div>
    );
  }
  if ('reason' in shown) {
    return (
      <p className="text-caption text-muted-foreground" role="status">
        {t(`reason.${shown.reason}`)}
      </p>
    );
  }
  return (
    <p className="text-caption text-destructive" role="alert">
      {shown.error}
    </p>
  );
}
